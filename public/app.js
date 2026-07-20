"use strict";

/*
  Torn Commander Sandbox
  Step 1 frontend controller

  This file handles:
  - Socket.IO server connection
  - Connection-status display
  - Home-page buttons
  - Temporary notifications
  - Basic error handling
*/

document.addEventListener("DOMContentLoaded", () => {
  const elements = {
    connectionStatus: document.getElementById("connectionStatus"),
    connectionText: document.getElementById("connectionText"),
    messageToast: document.getElementById("messageToast"),

    createGameButton: document.getElementById("createGameButton"),
    joinGameButton: document.getElementById("joinGameButton"),
    myDecksButton: document.getElementById("myDecksButton"),

    bottomDecksButton: document.getElementById("bottomDecksButton"),
    bottomGamesButton: document.getElementById("bottomGamesButton"),
    bottomSettingsButton: document.getElementById("bottomSettingsButton")
  };

  let socket = null;
  let toastTimer = null;

  /*
    Safely displays a temporary message near the bottom
    of the screen.
  */
  function showToast(message, type = "default", duration = 2800) {
    if (!elements.messageToast) {
      return;
    }

    window.clearTimeout(toastTimer);

    elements.messageToast.textContent = message;
    elements.messageToast.className = "message-toast";

    if (type === "success") {
      elements.messageToast.classList.add("success");
    }

    if (type === "error") {
      elements.messageToast.classList.add("error");
    }

    requestAnimationFrame(() => {
      elements.messageToast.classList.add("visible");
    });

    toastTimer = window.setTimeout(() => {
      elements.messageToast.classList.remove("visible");
    }, duration);
  }

  /*
    Updates the server-connection pill in the header.
  */
  function updateConnectionStatus(status, text) {
    if (!elements.connectionStatus || !elements.connectionText) {
      return;
    }

    elements.connectionStatus.classList.remove(
      "connecting",
      "connected",
      "disconnected"
    );

    elements.connectionStatus.classList.add(status);
    elements.connectionText.textContent = text;
  }

  /*
    Connects the browser to the multiplayer server.
  */
  function connectToServer() {
    if (typeof window.io !== "function") {
      updateConnectionStatus("disconnected", "Offline");

      showToast(
        "The multiplayer connection library could not load.",
        "error",
        4500
      );

      return;
    }

    updateConnectionStatus("connecting", "Connecting");

    try {
      socket = window.io({
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
      });
    } catch (error) {
      console.error("Socket connection failed:", error);

      updateConnectionStatus("disconnected", "Offline");

      showToast(
        "Unable to connect to the Commander server.",
        "error",
        4500
      );

      return;
    }

    socket.on("connect", () => {
      console.info("Connected to server:", socket.id);

      updateConnectionStatus("connected", "Connected");
    });

    socket.on("disconnect", (reason) => {
      console.warn("Disconnected from server:", reason);

      updateConnectionStatus("disconnected", "Offline");

      if (reason !== "io client disconnect") {
        showToast(
          "Connection lost. Trying to reconnect…",
          "error",
          3200
        );
      }
    });

    socket.io.on("reconnect_attempt", () => {
      updateConnectionStatus("connecting", "Reconnecting");
    });

    socket.io.on("reconnect", () => {
      updateConnectionStatus("connected", "Connected");

      showToast(
        "Reconnected to the Commander server.",
        "success"
      );
    });

    socket.io.on("reconnect_error", (error) => {
      console.error("Reconnect error:", error);

      updateConnectionStatus("disconnected", "Offline");
    });

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error);

      updateConnectionStatus("disconnected", "Offline");
    });

    socket.on("server-message", (payload) => {
      if (!payload || typeof payload.message !== "string") {
        return;
      }

      showToast(
        payload.message,
        payload.type || "default"
      );
    });
  }

  /*
    Step 1 buttons currently show placeholders.

    In Step 2 these will open real screens for:
    - Creating a room
    - Joining a room
    - Viewing the multiplayer lobby
  */
  function handleCreateGame() {
    if (!socket || !socket.connected) {
      showToast(
        "Connect to the server before creating a game.",
        "error"
      );

      return;
    }

    showToast(
      "Create Game will become active in Step 2.",
      "success"
    );
  }

  function handleJoinGame() {
    if (!socket || !socket.connected) {
      showToast(
        "Connect to the server before joining a game.",
        "error"
      );

      return;
    }

    showToast(
      "Join Game will become active in Step 2.",
      "success"
    );
  }

  function handleMyDecks() {
    showToast(
      "Deck importing will be added after the multiplayer lobby."
    );
  }

  function handleGamesNavigation() {
    showToast(
      "Your active and recent games will appear here."
    );
  }

  function handleSettingsNavigation() {
    showToast(
      "Player and Torn settings will be added later."
    );
  }

  /*
    Attach button handlers only when each element exists.
  */
  elements.createGameButton?.addEventListener(
    "click",
    handleCreateGame
  );

  elements.joinGameButton?.addEventListener(
    "click",
    handleJoinGame
  );

  elements.myDecksButton?.addEventListener(
    "click",
    handleMyDecks
  );

  elements.bottomDecksButton?.addEventListener(
    "click",
    handleMyDecks
  );

  elements.bottomGamesButton?.addEventListener(
    "click",
    handleGamesNavigation
  );

  elements.bottomSettingsButton?.addEventListener(
    "click",
    handleSettingsNavigation
  );

  /*
    Make the app more resistant to unexpected browser errors.
  */
  window.addEventListener("error", (event) => {
    console.error("Application error:", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", event.reason);
  });

  /*
    Disconnect cleanly when the page is closed.
  */
  window.addEventListener("beforeunload", () => {
    if (socket && socket.connected) {
      socket.disconnect();
    }
  });

  connectToServer();
});
