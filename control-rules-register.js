"use strict";

const path = require("path");
const Module = require("module");

const serverPath =
  path.resolve(__dirname, "server.js");
const previousLoader =
  Module._extensions[".js"];

function injectControlRules(source) {
  if (
    source.includes(
      "Arena Commander v58 control-rules integration"
    )
  ) {
    return source;
  }

  const integration = `

// ---- Arena Commander v58 control-rules integration ----
(() => {
  const {
    createControlRulesEngine
  } = require("./control-rules-engine");

  const controlRulesEngine =
    createControlRulesEngine({
      PHASES,
      createId,
      nowIso,
      currentCardFace,
      currentTypeLine,
      currentOracleText,
      isCreatureCard,
      findPlayer,
      findBattlefieldCard,
      publicCard,
      queueSuggestedTriggers,
      runStateBasedActions,
      addLog
    });

  const v58LegacyProcessGameAction =
    processGameAction;
  processGameAction =
    function controlRulesProcessGameAction(
      room,
      actor,
      action
    ) {
      return controlRulesEngine.processGameAction(
        room,
        actor,
        action,
        v58LegacyProcessGameAction
      );
    };

  const v58LegacyResolveStackTop =
    resolveStackTop;
  resolveStackTop =
    function controlRulesResolveStackTop(
      room,
      resolverName
    ) {
      const item =
        room.stack?.at(-1) || null;
      const result =
        v58LegacyResolveStackTop(
          room,
          resolverName
        );

      return controlRulesEngine.afterResolve(
        room,
        item,
        result
      );
    };

  const v58LegacyCreatePublicRoom =
    createPublicRoom;
  createPublicRoom =
    function controlRulesCreatePublicRoom(
      room,
      viewerId
    ) {
      const publicRoom =
        v58LegacyCreatePublicRoom(
          room,
          viewerId
        );

      publicRoom.controlV58 =
        controlRulesEngine.summary(room);

      return publicRoom;
    };

  app.post(
    "/api/control-v58/state",
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
        controlRulesEngine.state(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/control-v58/action",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      const allowed = new Set([
        "control-v58-gain",
        "control-v58-exchange",
        "control-v58-return",
        "control-v58-cleanup-player"
      ]);
      const type =
        String(request.body?.type || "");

      if (!allowed.has(type)) {
        return response.status(400).json({
          success: false,
          error:
            "Unsupported v58 control action."
        });
      }

      const result =
        controlRulesEngine.processGameAction(
          auth.room,
          auth.player,
          request.body,
          v58LegacyProcessGameAction
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
    "/api/control-v58/status",
    (_request, response) => {
      response.json(
        controlRulesEngine.status()
      );
    }
  );

  console.log(
    "Arena Commander control, ownership, exchange and leave-game engine v58.0.0 installed."
  );
})();
// ---- End Arena Commander v58 control-rules integration ----
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
      "Arena Commander v58 found no safe server insertion point."
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
  function controlRulesRegister(
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
      function compileWithControlRules(
        source,
        compiledFilename
      ) {
        module._compile =
          originalCompile;

        return originalCompile.call(
          module,
          injectControlRules(
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
