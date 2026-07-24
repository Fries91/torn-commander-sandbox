"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectMultiplayerRules(source) {
  if (source.includes("Arena Commander v56 multiplayer-rules integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v56 multiplayer-rules integration ----
(() => {
  const {
    createMultiplayerRulesEngine
  } = require("./multiplayer-rules-engine");

  const multiplayerRulesEngine =
    createMultiplayerRulesEngine({
      PHASES,
      createId,
      nowIso,
      currentCardFace,
      currentTypeLine,
      currentOracleText,
      isCreatureCard,
      effectiveStats,
      findPlayer,
      findBattlefieldCard,
      locateCard,
      migrateCard,
      publicCard,
      pushStack,
      resetPriority,
      queueSuggestedTriggers,
      runStateBasedActions,
      addLog
    });

  const v56LegacyProcessGameAction =
    processGameAction;
  processGameAction =
    function multiplayerRulesProcessGameAction(
      room,
      actor,
      action
    ) {
      return multiplayerRulesEngine.processGameAction(
        room,
        actor,
        action,
        v56LegacyProcessGameAction
      );
    };

  const v56LegacyResolveStackTop =
    resolveStackTop;
  resolveStackTop =
    function multiplayerRulesResolveStackTop(
      room,
      resolverName
    ) {
      const item = room.stack?.at(-1) || null;
      const gate =
        multiplayerRulesEngine.beforeResolve(
          room,
          item
        );

      if (gate?.blocked) {
        return null;
      }

      const beforeBattlefieldIds =
        multiplayerRulesEngine.beforeBattlefield(
          room
        );
      const result =
        v56LegacyResolveStackTop(
          room,
          resolverName
        );

      return multiplayerRulesEngine.afterResolve(
        room,
        item,
        beforeBattlefieldIds,
        result
      );
    };

  const v56LegacyDealPlayerDamage =
    dealPlayerDamage;
  dealPlayerDamage =
    function multiplayerRulesDealPlayerDamage(
      room,
      source,
      target,
      amount
    ) {
      return multiplayerRulesEngine.playerDamage(
        room,
        source,
        target,
        amount,
        v56LegacyDealPlayerDamage
      );
    };

  const v56LegacyCreatePublicRoom =
    createPublicRoom;
  createPublicRoom =
    function multiplayerRulesCreatePublicRoom(
      room,
      viewerId
    ) {
      const publicRoom =
        v56LegacyCreatePublicRoom(
          room,
          viewerId
        );
      publicRoom.multiplayerV56 =
        multiplayerRulesEngine.summary(room);
      return publicRoom;
    };

  app.post(
    "/api/multiplayer-v56/state",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      response.setHeader(
        "Cache-Control",
        "no-store"
      );
      return response.json(
        multiplayerRulesEngine.state(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/multiplayer-v56/pending",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      response.setHeader(
        "Cache-Control",
        "no-store"
      );
      return response.json(
        multiplayerRulesEngine.pending(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/multiplayer-v56/action",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      const allowed = new Set([
        "multiplayer-v56-monarch",
        "multiplayer-v56-initiative",
        "multiplayer-v56-venture",
        "multiplayer-v56-start-vote",
        "multiplayer-v56-vote"
      ]);
      const type = String(
        request.body?.type || ""
      );

      if (!allowed.has(type)) {
        return response.status(400).json({
          success: false,
          error:
            "Unsupported v56 multiplayer action."
        });
      }

      const result =
        multiplayerRulesEngine.processGameAction(
          auth.room,
          auth.player,
          request.body,
          v56LegacyProcessGameAction
        );

      if (!result.success) {
        return response.status(400).json(
          result
        );
      }

      recordReplayFrame(
        auth.room,
        auth.player.name,
        type
      );
      queueRoomSave(auth.room, true);
      emitRoomUpdate(auth.room);
      scheduleBots(auth.room, true);

      return response.json({
        success: true,
        result
      });
    }
  );

  app.post(
    "/api/multiplayer-v56/resolve-choice",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      const result =
        multiplayerRulesEngine.processGameAction(
          auth.room,
          auth.player,
          {
            ...request.body,
            type:
              "multiplayer-v56-resolve-choice"
          },
          v56LegacyProcessGameAction
        );

      if (!result.success) {
        return response.status(400).json(
          result
        );
      }

      recordReplayFrame(
        auth.room,
        auth.player.name,
        "Resolved multiplayer choice"
      );
      queueRoomSave(auth.room, true);
      emitRoomUpdate(auth.room);
      scheduleBots(auth.room, true);

      return response.json({
        success: true,
        result
      });
    }
  );

  app.get(
    "/api/multiplayer-v56/status",
    (_request, response) => {
      response.json(
        multiplayerRulesEngine.status()
      );
    }
  );

  console.log(
    "Arena Commander Monarch, Initiative, Dungeons and voting engine v56.0.0 installed."
  );
})();
// ---- End Arena Commander v56 multiplayer-rules integration ----
`;

  const patterns = [
    /\napp\.get\(\s*["']\*["']\s*,/,
    /\napp\.use\(\s*["']\/api["']\s*,/,
    /\nasync\s+function\s+start\s*\(/,
    /\n\s*server\.listen\s*\(/
  ];

  let insertAt = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) {
      insertAt = match.index;
      break;
    }
  }

  if (insertAt < 0) {
    console.error(
      "Arena Commander v56 found no safe server insertion point."
    );
    return source;
  }

  return (
    source.slice(0, insertAt) +
    integration +
    source.slice(insertAt)
  );
}

Module._extensions[".js"] =
  function multiplayerRulesRegister(
    module,
    filename
  ) {
    if (path.resolve(filename) !== serverPath) {
      return previousLoader(module, filename);
    }

    Module._extensions[".js"] =
      previousLoader;
    const originalCompile = module._compile;

    module._compile =
      function compileWithMultiplayerRules(
        source,
        compiledFilename
      ) {
        module._compile = originalCompile;
        return originalCompile.call(
          module,
          injectMultiplayerRules(
            String(source)
          ),
          compiledFilename
        );
      };

    return previousLoader(module, filename);
  };
