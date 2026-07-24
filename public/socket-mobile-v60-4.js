(() => {
  "use strict";
  const realIo = window.io;

  if (typeof realIo !== "function") {
    console.error("Socket.IO client was not loaded.");
    return;
  }

  function reliableIo(uri, options) {
    let target = uri;
    let settings = options;

    if (uri && typeof uri === "object") {
      settings = uri;
      target = undefined;
    }

    const merged = {
      ...(settings || {}),
      path: "/socket.io",
      transports: ["polling", "websocket"],
      upgrade: true,
      rememberUpgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 20000
    };

    return target == null
      ? realIo(merged)
      : realIo(target, merged);
  }

  Object.assign(reliableIo, realIo);
  Object.setPrototypeOf(reliableIo, realIo);
  window.io = reliableIo;
})();
