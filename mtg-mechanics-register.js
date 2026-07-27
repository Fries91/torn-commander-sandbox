"use strict";

const path = require("path");
const Module = require("module");

const SERVER_PATH = path.resolve(__dirname, "server.js");
const VERSION = "63.1.0";
const MARKER = "Arena Commander MTG mechanics compatibility bridge v63.1";

function injectMtgMechanicsBridge(sourceInput) {
  const source = String(sourceInput || "");
  if (source.includes(MARKER)) return source;

  const integration = String.raw`

// ---- ${MARKER} ----
(() => {
  const mtgMechanicsBridge = require("./mtg-mechanics-adapter");
  mtgMechanicsBridge.initialize()
    .then((status) => console.log("MTG mechanics bridge v${VERSION} ready in " + status.mode + " mode."))
    .catch((error) => console.warn("MTG mechanics bridge failed to initialize:", error?.message || error));

  const mtgLegacyProcessGameAction = processGameAction;
  processGameAction = function mtgMechanicsProcessGameAction(room, actor, action) {
    const result = mtgLegacyProcessGameAction(room, actor, action);
    if (result?.success) {
      mtgMechanicsBridge.scheduleRoomSync(room, {
        reason: "game-action",
        actionType: action?.type || "unknown",
        actorId: actor?.id || null
      });
    }
    return result;
  };

  const mtgLegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function mtgMechanicsCreatePublicRoom(room, viewerId) {
    const publicRoom = mtgLegacyCreatePublicRoom(room, viewerId);
    publicRoom.mtgMechanicsV63 = mtgMechanicsBridge.getRoomStatus(room);
    return publicRoom;
  };

  const mtgLegacyEmitRoomUpdate = emitRoomUpdate;
  emitRoomUpdate = function mtgMechanicsEmitRoomUpdate(room, ...args) {
    mtgMechanicsBridge.scheduleRoomSync(room, { reason: "room-update" });
    return mtgLegacyEmitRoomUpdate(room, ...args);
  };

  app.get("/api/mtg-mechanics/status", async (_request, response) => {
    try {
      const status = await mtgMechanicsBridge.initialize();
      response.json({ success: true, version: "${VERSION}", ...status });
    } catch (error) {
      response.status(500).json({ success: false, version: "${VERSION}", error: error?.message || String(error) });
    }
  });

  app.post("/api/mtg-mechanics/validate-room", async (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    try {
      const status = await mtgMechanicsBridge.syncRoom(auth.room, {
        reason: "manual-validation",
        actorId: auth.player.id
      });
      return response.json({ success: true, status });
    } catch (error) {
      return response.status(400).json({ success: false, error: error?.message || String(error) });
    }
  });

  app.post("/api/mtg-mechanics/validate-card-script", (request, response) => {
    const result = mtgMechanicsBridge.validateCardScript(request.body?.script);
    response.status(result.valid ? 200 : 400).json({ success: result.valid, ...result });
  });
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
  if (insertAt < 0) throw new Error("MTG mechanics bridge could not find a safe server insertion point.");
  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

const previousLoader = Module._extensions[".js"];
if (process.env.MTG_MECHANICS_TEST_MODE !== "1") {
  Module._extensions[".js"] = function mtgMechanicsRegister(module, filename) {
    if (path.resolve(filename) !== SERVER_PATH) return previousLoader(module, filename);
    Module._extensions[".js"] = previousLoader;
    const originalCompile = module._compile;
    module._compile = function compileWithMtgMechanics(source, compiledFilename) {
      module._compile = originalCompile;
      return originalCompile.call(module, injectMtgMechanicsBridge(source), compiledFilename);
    };
    return previousLoader(module, filename);
  };
}

module.exports = {
  version: VERSION,
  marker: MARKER,
  injectMtgMechanicsBridge
};
