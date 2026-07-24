"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectCommanderRules(source) {
  if (source.includes("Arena Commander v55 commander-rules integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v55 commander-rules integration ----
(() => {
  const {
    createCommanderRulesEngine
  } = require("./commander-rules-engine");

  const commanderRulesEngine =
    createCommanderRulesEngine({
      PHASES,
      createId,
      nowIso,
      currentCardFace,
      currentTypeLine,
      currentOracleText,
      isCreatureCard,
      isPermanentCard,
      effectiveStats,
      findPlayer,
      findBattlefieldCard,
      getCardFromZone,
      locateCard,
      migrateCard,
      publicCard,
      resetPriority,
      queueSuggestedTriggers,
      runStateBasedActions,
      addLog
    });

  const v55LegacyProcessGameAction =
    processGameAction;
  processGameAction =
    function commanderRulesProcessGameAction(
      room,
      actor,
      action
    ) {
      return commanderRulesEngine.processGameAction(
        room,
        actor,
        action,
        v55LegacyProcessGameAction
      );
    };

  const v55LegacyResolveStackTop =
    resolveStackTop;
  resolveStackTop =
    function commanderRulesResolveStackTop(
      room,
      resolverName
    ) {
      const before =
        commanderRulesEngine.snapshot(room);
      const result =
        v55LegacyResolveStackTop(
          room,
          resolverName
        );

      return commanderRulesEngine.afterResolve(
        room,
        before,
        result
      );
    };

  const v55LegacyDealPlayerDamage =
    dealPlayerDamage;
  dealPlayerDamage =
    function commanderRulesDealPlayerDamage(
      room,
      source,
      target,
      amount
    ) {
      return commanderRulesEngine.playerDamage(
        room,
        source,
        target,
        amount,
        v55LegacyDealPlayerDamage
      );
    };

  const v55LegacyCreatePublicRoom =
    createPublicRoom;
  createPublicRoom =
    function commanderRulesCreatePublicRoom(
      room,
      viewerId
    ) {
      const publicRoom =
        v55LegacyCreatePublicRoom(
          room,
          viewerId
        );
      publicRoom.commanderV55 =
        commanderRulesEngine.summary(room);
      return publicRoom;
    };

  app.post(
    "/api/commander-v55/state",
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
        commanderRulesEngine.state(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/commander-v55/pending",
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
        commanderRulesEngine.pending(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/commander-v55/action",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      const allowed = new Set([
        "commander-v55-designate-companion",
        "commander-v55-take-companion",
        "commander-v55-return"
      ]);
      const type = String(
        request.body?.type || ""
      );

      if (!allowed.has(type)) {
        return response.status(400).json({
          success: false,
          error: "Unsupported v55 Commander action."
        });
      }

      const result =
        commanderRulesEngine.processGameAction(
          auth.room,
          auth.player,
          request.body,
          v55LegacyProcessGameAction
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
    "/api/commander-v55/resolve-zone",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      const result =
        commanderRulesEngine.processGameAction(
          auth.room,
          auth.player,
          {
            type: "commander-v55-resolve-zone",
            choiceId:
              request.body?.choiceId,
            moveToCommandZone:
              Boolean(
                request.body?.moveToCommandZone
              )
          },
          v55LegacyProcessGameAction
        );

      if (!result.success) {
        return response.status(400).json(
          result
        );
      }

      recordReplayFrame(
        auth.room,
        auth.player.name,
        "Resolved commander zone choice"
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
    "/api/commander-v55/status",
    (_request, response) => {
      response.json(
        commanderRulesEngine.status()
      );
    }
  );

  console.log(
    "Arena Commander complete Commander rules engine v55.0.0 installed."
  );
})();
// ---- End Arena Commander v55 commander-rules integration ----
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
      "Arena Commander v55 found no safe server insertion point."
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
  function commanderRulesRegister(
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
      function compileWithCommanderRules(
        source,
        compiledFilename
      ) {
        module._compile = originalCompile;
        return originalCompile.call(
          module,
          injectCommanderRules(
            String(source)
          ),
          compiledFilename
        );
      };

    return previousLoader(module, filename);
  };
