"use strict";

const path = require("path");
const Module = require("module");

const serverPath =
  path.resolve(__dirname, "server.js");
const previousLoader =
  Module._extensions[".js"];

function injectTurnRules(source) {
  if (
    source.includes(
      "Arena Commander v60 turn-rules integration"
    )
  ) {
    return source;
  }

  const integration = `

// ---- Arena Commander v60 turn-rules integration ----
(() => {
  const {
    createTurnRulesEngine
  } = require("./turn-rules-engine");

  let v60LegacyAdvanceTurn =
    advanceTurn;

  const turnRulesEngine =
    createTurnRulesEngine({
      PHASES,
      createId,
      nowIso,
      currentCardFace,
      currentOracleText,
      findPlayer,
      activePlayers,
      clearCombat,
      clearDamage,
      clearMana,
      expireEndOfTurnEffects,
      resetPriority,
      resetTurnDeadline,
      queueSuggestedTriggers,
      runStateBasedActions,
      addLog,
      advanceTurn(room) {
        return advanceTurn(room);
      }
    });

  advanceTurn =
    function turnRulesAdvanceTurn(room) {
      return turnRulesEngine.advanceTurn(
        room,
        v60LegacyAdvanceTurn
      );
    };

  const v60LegacyProcessGameAction =
    processGameAction;
  processGameAction =
    function turnRulesProcessGameAction(
      room,
      actor,
      action
    ) {
      return turnRulesEngine.processGameAction(
        room,
        actor,
        action,
        v60LegacyProcessGameAction
      );
    };

  const v60LegacyResolveStackTop =
    resolveStackTop;
  resolveStackTop =
    function turnRulesResolveStackTop(
      room,
      resolverName
    ) {
      const item =
        room.stack?.at(-1) || null;

      const before =
        turnRulesEngine.beforeResolve(
          room,
          item
        );

      if (before?.handled) {
        return before.result;
      }

      const result =
        v60LegacyResolveStackTop(
          room,
          resolverName
        );

      return turnRulesEngine.afterResolve(
        room,
        item,
        result
      );
    };

  const v60LegacyCreatePublicRoom =
    createPublicRoom;
  createPublicRoom =
    function turnRulesCreatePublicRoom(
      room,
      viewerId
    ) {
      const publicRoom =
        v60LegacyCreatePublicRoom(
          room,
          viewerId
        );

      publicRoom.turnV60 =
        turnRulesEngine.summary(room);

      return publicRoom;
    };

  app.post(
    "/api/turn-v60/state",
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
        turnRulesEngine.state(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/turn-v60/action",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      const allowed = new Set([
        "turn-v60-extra-turn",
        "turn-v60-skip-turn",
        "turn-v60-add-phase",
        "turn-v60-skip-phase",
        "turn-v60-end-turn",
        "turn-v60-end-combat",
        "turn-v60-reverse-order"
      ]);
      const type =
        String(request.body?.type || "");

      if (!allowed.has(type)) {
        return response.status(400).json({
          success: false,
          error:
            "Unsupported v60 turn action."
        });
      }

      const result =
        turnRulesEngine.processGameAction(
          auth.room,
          auth.player,
          request.body,
          v60LegacyProcessGameAction
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

  app.get(
    "/api/turn-v60/status",
    (_request, response) => {
      response.json(
        turnRulesEngine.status()
      );
    }
  );

  console.log(
    "Arena Commander turn order, extra turns, skipped turns and phase-control engine v60.0.0 installed."
  );
})();
// ---- End Arena Commander v60 turn-rules integration ----
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
      "Arena Commander v60 found no safe server insertion point."
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
  function turnRulesRegister(
    module,
    filename
  ) {
    if (
      path.resolve(filename) !==
      serverPath
    ) {
      return previousLoader(
        module,
        filename
      );
    }

    Module._extensions[".js"] =
      previousLoader;
    const originalCompile =
      module._compile;

    module._compile =
      function compileWithTurnRules(
        source,
        compiledFilename
      ) {
        module._compile =
          originalCompile;

        return originalCompile.call(
          module,
          injectTurnRules(
            String(source)
          ),
          compiledFilename
        );
      };

    return previousLoader(
      module,
      filename
    );
  };
