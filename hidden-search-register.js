"use strict";

const path = require("path");
const Module = require("module");

const serverPath =
  path.resolve(__dirname, "server.js");
const previousLoader =
  Module._extensions[".js"];

function injectHiddenSearch(source) {
  if (
    source.includes(
      "Arena Commander v59 hidden-search integration"
    )
  ) {
    return source;
  }

  const integration = `

// ---- Arena Commander v59 hidden-search integration ----
(() => {
  const {
    createHiddenSearchEngine
  } = require("./hidden-search-engine");

  const hiddenSearchEngine =
    createHiddenSearchEngine({
      PHASES,
      createId,
      nowIso,
      currentCardFace,
      currentTypeLine,
      currentOracleText,
      isCreatureCard,
      findPlayer,
      publicCard,
      queueSuggestedTriggers,
      runStateBasedActions,
      addLog
    });

  const v59LegacyProcessGameAction =
    processGameAction;
  processGameAction =
    function hiddenSearchProcessGameAction(
      room,
      actor,
      action
    ) {
      return hiddenSearchEngine.processGameAction(
        room,
        actor,
        action,
        v59LegacyProcessGameAction
      );
    };

  const v59LegacyResolveStackTop =
    resolveStackTop;
  resolveStackTop =
    function hiddenSearchResolveStackTop(
      room,
      resolverName
    ) {
      const item =
        room.stack?.at(-1) || null;
      const beforeZones =
        hiddenSearchEngine.beforeZones(room);
      const result =
        v59LegacyResolveStackTop(
          room,
          resolverName
        );

      return hiddenSearchEngine.afterResolve(
        room,
        item,
        beforeZones,
        result
      );
    };

  const v59LegacyCreatePublicRoom =
    createPublicRoom;
  createPublicRoom =
    function hiddenSearchCreatePublicRoom(
      room,
      viewerId
    ) {
      const publicRoom =
        v59LegacyCreatePublicRoom(
          room,
          viewerId
        );

      publicRoom.hiddenV59 =
        hiddenSearchEngine.summary(room);

      return publicRoom;
    };

  app.post(
    "/api/hidden-v59/state",
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
        hiddenSearchEngine.state(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/hidden-v59/pending",
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
        hiddenSearchEngine.pending(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/hidden-v59/action",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      const allowed = new Set([
        "hidden-v59-create-search",
        "hidden-v59-create-look",
        "hidden-v59-resolve-search",
        "hidden-v59-resolve-look",
        "hidden-v59-shuffle",
        "hidden-v59-reveal-hand",
        "hidden-v59-clear-reveal"
      ]);
      const type =
        String(request.body?.type || "");

      if (!allowed.has(type)) {
        return response.status(400).json({
          success: false,
          error:
            "Unsupported v59 hidden-information action."
        });
      }

      const result =
        hiddenSearchEngine.processGameAction(
          auth.room,
          auth.player,
          request.body,
          v59LegacyProcessGameAction
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
    "/api/hidden-v59/status",
    (_request, response) => {
      response.json(
        hiddenSearchEngine.status()
      );
    }
  );

  console.log(
    "Arena Commander hidden information, search, reveal and shuffle engine v59.0.0 installed."
  );
})();
// ---- End Arena Commander v59 hidden-search integration ----
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
      "Arena Commander v59 found no safe server insertion point."
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
  function hiddenSearchRegister(
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
      function compileWithHiddenSearch(
        source,
        compiledFilename
      ) {
        module._compile =
          originalCompile;

        return originalCompile.call(
          module,
          injectHiddenSearch(
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
