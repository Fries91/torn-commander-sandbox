"use strict";

const path = require("path");
const Module = require("module");

const SERVER_PATH = path.resolve(__dirname, "server.js");
const VERSION = "61.1.0";
const MARKER = "Arena Commander v61.1 automatic draw integration";

function injectAutomaticDraw(sourceInput) {
  const source = String(sourceInput || "");
  if (source.includes(MARKER)) return source;

  const integration = `

// ---- ${MARKER} ----
(() => {
  const AUTO_DRAW_VERSION = "${VERSION}";

  function automaticDrawState(room) {
    room.autoDrawV611 =
      room.autoDrawV611 &&
      typeof room.autoDrawV611 === "object"
        ? room.autoDrawV611
        : {};

    return room.autoDrawV611;
  }

  function currentDrawPhaseName(room) {
    const phaseIndex = Number(
      room?.turn?.phaseIndex ?? -1
    );

    return String(
      room?.turnV60?.currentPhase ||
      room?.turnV60?.phaseName ||
      room?.phases?.[phaseIndex] ||
      PHASES?.[phaseIndex] ||
      ""
    ).trim();
  }

  function isDrawPhase(room) {
    return /^draw(?:\\s+step|\\s+phase)?$/i.test(
      currentDrawPhaseName(room)
    );
  }

  function automaticDrawKey(room) {
    return [
      Number(room?.turn?.number || 0),
      String(room?.turn?.activePlayerId || ""),
      Number(room?.turn?.phaseIndex ?? -1),
      currentDrawPhaseName(room).toLowerCase()
    ].join(":");
  }

  function firstPlayerSkipsNormalDraw(room) {
    return (
      Number(room?.turn?.number || 0) === 1 &&
      room?.formatRules?.firstPlayerDraw === false
    );
  }

  const legacyApplySimpleEffectV611 =
    applySimpleEffect;

  applySimpleEffect =
    function automaticCardDrawEffectV611(
      room,
      item
    ) {
      const before = new Map(
        (room?.players || []).map((player) => [
          String(player.id),
          Number(player.game?.hand?.length || 0)
        ])
      );

      const result =
        legacyApplySimpleEffectV611(
          room,
          item
        );

      for (const player of room?.players || []) {
        const oldCount =
          before.get(String(player.id)) || 0;
        const newCount =
          Number(player.game?.hand?.length || 0);
        const difference = newCount - oldCount;

        if (difference > 0) {
          addLog(
            room,
            player.name +
              " automatically drew " +
              difference +
              " card" +
              (difference === 1 ? "" : "s") +
              (item?.name ? " from " + item.name : "") +
              ".",
            "card"
          );
        }
      }

      return result;
    };

  const legacyProcessGameActionV611 =
    processGameAction;

  function performNormalDrawV611(room) {
    if (!room?.turn || !isDrawPhase(room)) {
      return null;
    }

    const state = automaticDrawState(room);
    const key = automaticDrawKey(room);

    if (!key || state.lastCompletedKey === key) {
      return null;
    }

    const player = findPlayer(
      room,
      room.turn.activePlayerId
    );

    if (
      !player?.game ||
      player.game.lost ||
      player.game.conceded
    ) {
      state.lastCompletedKey = key;
      return null;
    }

    state.lastCompletedKey = key;
    state.lastTurnNumber =
      Number(room.turn.number || 0);
    state.lastPlayerId =
      String(player.id || "");
    state.lastPhaseIndex =
      Number(room.turn.phaseIndex ?? -1);

    if (firstPlayerSkipsNormalDraw(room)) {
      state.lastResult = "skipped-first-draw";
      addLog(
        room,
        player.name +
          " skipped the first draw step under this format's rules.",
        "turn"
      );
      return {
        success: true,
        skipped: true,
        drawn: 0
      };
    }

    const beforeHand =
      Number(player.game.hand?.length || 0);

    const drawResult =
      legacyProcessGameActionV611(
        room,
        player,
        {
          type: "draw",
          amount: 1,
          automaticDrawV611: true
        }
      );

    const afterHand =
      Number(player.game.hand?.length || 0);
    const drawn = Math.max(
      0,
      afterHand - beforeHand
    );

    state.lastResult =
      drawResult?.success
        ? drawn > 0
          ? "drawn"
          : "empty-library"
        : "failed";
    state.lastDrawn = drawn;
    state.lastAt = nowIso();

    if (drawResult?.success && drawn > 0) {
      addLog(
        room,
        player.name +
          " automatically drew for the draw step.",
        "turn"
      );
    }

    return {
      ...drawResult,
      automatic: true,
      drawn
    };
  }

  processGameAction =
    function automaticDrawProcessGameActionV611(
      room,
      actor,
      action
    ) {
      const result =
        legacyProcessGameActionV611(
          room,
          actor,
          action
        );

      if (!result?.success) {
        return result;
      }

      if (
        action?.type === "draw" &&
        isDrawPhase(room)
      ) {
        const state = automaticDrawState(room);
        state.lastCompletedKey =
          automaticDrawKey(room);
        state.lastResult =
          action?.automaticDrawV611
            ? state.lastResult || "drawn"
            : "manual-draw";

        return result;
      }

      const autoDraw =
        performNormalDrawV611(room);

      if (autoDraw) {
        result.autoDrawV611 = autoDraw;
      }

      return result;
    };

  const legacyCreatePublicRoomV611 =
    createPublicRoom;

  createPublicRoom =
    function automaticDrawPublicRoomV611(
      room,
      viewerId
    ) {
      const publicRoom =
        legacyCreatePublicRoomV611(
          room,
          viewerId
        );

      publicRoom.autoDrawV611 = {
        version: AUTO_DRAW_VERSION,
        enabled: true,
        lastResult:
          room?.autoDrawV611?.lastResult || null,
        lastDrawn:
          Number(room?.autoDrawV611?.lastDrawn || 0),
        lastPlayerId:
          room?.autoDrawV611?.lastPlayerId || null,
        lastTurnNumber:
          Number(room?.autoDrawV611?.lastTurnNumber || 0)
      };

      return publicRoom;
    };

  app.get(
    "/api/auto-draw-v61/status",
    (_request, response) => {
      response.json({
        success: true,
        version: AUTO_DRAW_VERSION,
        normalDrawStep: "automatic",
        cardDrawEffects: "automatic when supported by the card engine",
        firstPlayerDrawRule: "respected"
      });
    }
  );

  console.log(
    "Arena Commander automatic draw engine v" +
      AUTO_DRAW_VERSION +
      " installed."
  );
})();
// ---- End ${MARKER} ----
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
    throw new Error(
      "Arena Commander v61.1 could not find a safe server insertion point."
    );
  }

  return (
    source.slice(0, insertAt) +
    integration +
    source.slice(insertAt)
  );
}

const previousLoader = Module._extensions[".js"];

if (process.env.ARENA_V611_TEST_MODE !== "1") {
Module._extensions[".js"] =
  function automaticDrawRegisterV611(
    module,
    filename
  ) {
    if (path.resolve(filename) !== SERVER_PATH) {
      return previousLoader(module, filename);
    }

    Module._extensions[".js"] = previousLoader;
    const originalCompile = module._compile;

    module._compile =
      function compileWithAutomaticDrawV611(
        source,
        compiledFilename
      ) {
        module._compile = originalCompile;
        return originalCompile.call(
          module,
          injectAutomaticDraw(source),
          compiledFilename
        );
      };

    return previousLoader(module, filename);
  };
}

module.exports = {
  version: VERSION,
  marker: MARKER,
  injectAutomaticDraw
};
