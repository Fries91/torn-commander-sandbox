"use strict";

const path = require("path");
const Module = require("module");

const serverPath =
  path.resolve(__dirname, "server.js");
const previousLoader =
  Module._extensions[".js"];

function injectReplacementRules(source) {
  if (
    source.includes(
      "Arena Commander v57 replacement-rules integration"
    )
  ) {
    return source;
  }

  const integration = `

// ---- Arena Commander v57 replacement-rules integration ----
(() => {
  const {
    createReplacementRulesEngine
  } = require("./replacement-rules-engine");

  const replacementRulesEngine =
    createReplacementRulesEngine({
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
      addLog
    });

  const v57LegacyProcessGameAction =
    processGameAction;
  processGameAction =
    function replacementRulesProcessGameAction(
      room,
      actor,
      action
    ) {
      return replacementRulesEngine.processGameAction(
        room,
        actor,
        action,
        v57LegacyProcessGameAction
      );
    };

  const v57LegacyDealPlayerDamage =
    dealPlayerDamage;
  const v57LegacyDealPermanentDamage =
    dealCreatureDamage;

  dealPlayerDamage =
    function replacementRulesDealPlayerDamage(
      room,
      source,
      target,
      amount
    ) {
      return replacementRulesEngine.playerDamage(
        room,
        source,
        target,
        amount,
        v57LegacyDealPlayerDamage,
        v57LegacyDealPermanentDamage
      );
    };

  dealCreatureDamage =
    function replacementRulesDealPermanentDamage(
      room,
      source,
      target,
      amount
    ) {
      return replacementRulesEngine.permanentDamage(
        room,
        source,
        target,
        amount,
        v57LegacyDealPlayerDamage,
        v57LegacyDealPermanentDamage
      );
    };

  const v57LegacyCreatePublicRoom =
    createPublicRoom;
  createPublicRoom =
    function replacementRulesCreatePublicRoom(
      room,
      viewerId
    ) {
      const publicRoom =
        v57LegacyCreatePublicRoom(
          room,
          viewerId
        );

      publicRoom.replacementV57 =
        replacementRulesEngine.summary(room);

      return publicRoom;
    };

  app.post(
    "/api/replacement-v57/state",
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
        replacementRulesEngine.state(
          auth.room,
          auth.player.id
        )
      );
    }
  );

  app.post(
    "/api/replacement-v57/action",
    (request, response) => {
      const auth =
        authenticationFrom(request.body);
      if (!auth.success) {
        return response.status(401).json(auth);
      }

      const allowed = new Set([
        "replacement-v57-create",
        "replacement-v57-remove",
        "replacement-v57-preferences"
      ]);
      const type =
        String(request.body?.type || "");

      if (!allowed.has(type)) {
        return response.status(400).json({
          success: false,
          error:
            "Unsupported v57 replacement action."
        });
      }

      const result =
        replacementRulesEngine.processGameAction(
          auth.room,
          auth.player,
          request.body,
          v57LegacyProcessGameAction
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
    "/api/replacement-v57/status",
    (_request, response) => {
      response.json(
        replacementRulesEngine.status()
      );
    }
  );

  console.log(
    "Arena Commander replacement, prevention and redirection engine v57.0.0 installed."
  );
})();
// ---- End Arena Commander v57 replacement-rules integration ----
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
      "Arena Commander v57 found no safe server insertion point."
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
  function replacementRulesRegister(
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
      function compileWithReplacementRules(
        source,
        compiledFilename
      ) {
        module._compile =
          originalCompile;

        return originalCompile.call(
          module,
          injectReplacementRules(
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
