"use strict";

/*
  Torn Commander Sandbox
  Step 2 frontend controller

  Handles:
  - Server connection
  - Creating and joining rooms
  - Six-character room codes
  - Player lobby rendering
  - Ready status
  - Host controls
  - Room invitations
  - Reconnection sessions
  - Leaving and removing players
*/

document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEYS = {
    playerName: "tcs-player-name",
    roomSession: "tcs-room-session"
  };

  const elements = {
    connectionStatus: document.getElementById("connectionStatus"),
    connectionText: document.getElementById("connectionText"),
    headerSubtitle: document.getElementById("headerSubtitle"),
    messageToast: document.getElementById("messageToast"),

    homeView: document.getElementById("homeView"),
    lobbyView: document.getElementById("lobbyView"),
    bottomNavigation: document.getElementById("bottomNavigation"),

    createGameButton: document.getElementById("createGameButton"),
    joinGameButton: document.getElementById("joinGameButton"),
    myDecksButton: document.getElementById("myDecksButton"),

    bottomHomeButton: document.getElementById("bottomHomeButton"),
    bottomDecksButton: document.getElementById("bottomDecksButton"),
    bottomGamesButton: document.getElementById("bottomGamesButton"),
    bottomSettingsButton: document.getElementById("bottomSettingsButton"),

    rejoinPanel: document.getElementById("rejoinPanel"),
    rejoinRoomDetails: document.getElementById("rejoinRoomDetails"),
    rejoinRoomButton: document.getElementById("rejoinRoomButton"),

    createRoomModal: document.getElementById("createRoomModal"),
    createRoomForm: document.getElementById("createRoomForm"),
    createPlayerNameInput: document.getElementById(
      "createPlayerNameInput"
    ),
    createMaxPlayersSelect: document.getElementById(
      "createMaxPlayersSelect"
    ),
    createStartingLifeSelect: document.getElementById(
      "createStartingLifeSelect"
    ),
    privateRoomCheckbox: document.getElementById(
      "privateRoomCheckbox"
    ),
    submitCreateRoomButton: document.getElementById(
      "submitCreateRoomButton"
    ),

    joinRoomModal: document.getElementById("joinRoomModal"),
    joinRoomForm: document.getElementById("joinRoomForm"),
    joinPlayerNameInput: document.getElementById(
      "joinPlayerNameInput"
    ),
    joinRoomCodeInput: document.getElementById(
      "joinRoomCodeInput"
    ),
    submitJoinRoomButton: document.getElementById(
      "submitJoinRoomButton"
    ),

    leaveRoomModal: document.getElementById("leaveRoomModal"),
    leaveLobbyButton: document.getElementById("leaveLobbyButton"),
    cancelLeaveRoomButton: document.getElementById(
      "cancelLeaveRoomButton"
    ),
    confirmLeaveRoomButton: document.getElementById(
      "confirmLeaveRoomButton"
    ),

    lobbyTitle: document.getElementById("lobbyTitle"),
    lobbyStatusText: document.getElementById("lobbyStatusText"),

    roomCodeDisplay: document.getElementById("roomCodeDisplay"),
    copyRoomCodeButton: document.getElementById(
      "copyRoomCodeButton"
    ),
    shareRoomButton: document.getElementById("shareRoomButton"),
    copyInviteLinkButton: document.getElementById(
      "copyInviteLinkButton"
    ),

    playerCountDisplay: document.getElementById(
      "playerCountDisplay"
    ),
    startingLifeDisplay: document.getElementById(
      "startingLifeDisplay"
    ),
    readyCountBadge: document.getElementById("readyCountBadge"),
    playerList: document.getElementById("playerList"),
    playerRowTemplate: document.getElementById(
      "playerRowTemplate"
    ),

    readyButton: document.getElementById("readyButton"),
    readyButtonIcon: document.getElementById("readyButtonIcon"),
    readyButtonText: document.getElementById("readyButtonText"),

    hostControlsPanel: document.getElementById(
      "hostControlsPanel"
    ),
    hostMaxPlayersSelect: document.getElementById(
      "hostMaxPlayersSelect"
    ),
    hostStartingLifeSelect: document.getElementById(
      "hostStartingLifeSelect"
    ),
    saveRoomSettingsButton: document.getElementById(
      "saveRoomSettingsButton"
    ),
    startGameButton: document.getElementById("startGameButton"),
    startGameRequirement: document.getElementById(
      "startGameRequirement"
    )
  };

  const state = {
    socket: null,
    room: null,
    playerId: null,
    sessionToken: null,
    toastTimer: null,
    autoRejoinInProgress: false
  };

  /* =========================================
     Storage helpers
  ========================================= */

  function saveTextValue(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.warn("Unable to save local value:", error);
    }
  }

  function readTextValue(key) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch (error) {
      console.warn("Unable to read local value:", error);
      return "";
    }
  }

  function removeStoredValue(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn("Unable to remove local value:", error);
    }
  }

  function saveRoomSession(session) {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.roomSession,
        JSON.stringify(session)
      );
    } catch (error) {
      console.warn("Unable to save room session:", error);
    }

    updateRejoinPanel();
  }

  function readRoomSession() {
    try {
      const storedValue = window.localStorage.getItem(
        STORAGE_KEYS.roomSession
      );

      if (!storedValue) {
        return null;
      }

      const parsedValue = JSON.parse(storedValue);

      if (
        !parsedValue ||
        typeof parsedValue.roomCode !== "string" ||
        typeof parsedValue.playerId !== "string" ||
        typeof parsedValue.sessionToken !== "string"
      ) {
        return null;
      }

      return parsedValue;
    } catch (error) {
      console.warn("Unable to read room session:", error);
      return null;
    }
  }

  function clearRoomSession() {
    removeStoredValue(STORAGE_KEYS.roomSession);

    state.room = null;
    state.playerId = null;
    state.sessionToken = null;

    updateRejoinPanel();
  }

  /* =========================================
     Input helpers
  ========================================= */

  function normalizePlayerName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
  }

  function normalizeRoomCode(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function getPlayerInitial(name) {
    const cleanedName = normalizePlayerName(name);

    if (!cleanedName) {
      return "P";
    }

    const alphanumericCharacter = cleanedName.match(/[A-Za-z0-9]/);

    return alphanumericCharacter
      ? alphanumericCharacter[0].toUpperCase()
      : "P";
  }

  function getErrorMessage(response, fallbackMessage) {
    if (
      response &&
      typeof response.error === "string" &&
      response.error.trim()
    ) {
      return response.error;
    }

    return fallbackMessage;
  }

  /* =========================================
     Toast notifications
  ========================================= */

  function showToast(message, type = "default", duration = 3000) {
    if (!elements.messageToast) {
      return;
    }

    window.clearTimeout(state.toastTimer);

    elements.messageToast.textContent = message;
    elements.messageToast.className = "message-toast";

    if (type === "success") {
      elements.messageToast.classList.add("success");
    }

    if (type === "error") {
      elements.messageToast.classList.add("error");
    }

    window.requestAnimationFrame(() => {
      elements.messageToast.classList.add("visible");
    });

    state.toastTimer = window.setTimeout(() => {
      elements.messageToast.classList.remove("visible");
    }, duration);
  }

  /* =========================================
     Connection display
  ========================================= */

  function updateConnectionStatus(status, text) {
    if (
      !elements.connectionStatus ||
      !elements.connectionText
    ) {
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

  function isServerConnected() {
    return Boolean(
      state.socket &&
      state.socket.connected
    );
  }

  function requireServerConnection() {
    if (isServerConnected()) {
      return true;
    }

    showToast(
      "The Commander server is not connected yet.",
      "error"
    );

    return false;
  }

  /* =========================================
     Socket acknowledgement helper
  ========================================= */

  function emitWithAcknowledgement(
    eventName,
    payload,
    timeoutMilliseconds = 12000
  ) {
    return new Promise((resolve, reject) => {
      if (!isServerConnected()) {
        reject(new Error("The server is not connected."));
        return;
      }

      let settled = false;

      const timeout = window.setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;

        reject(
          new Error(
            "The server took too long to respond. Please try again."
          )
        );
      }, timeoutMilliseconds);

      state.socket.emit(eventName, payload, (response) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeout);

        resolve(response || {
          success: false,
          error: "The server returned an empty response."
        });
      });
    });
  }

  /* =========================================
     Button loading states
  ========================================= */

  async function runButtonAction(
    button,
    loadingText,
    action
  ) {
    if (!button || button.disabled) {
      return;
    }

    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = loadingText;

    try {
      await action();
    } catch (error) {
      console.error(error);

      showToast(
        error.message || "An unexpected error occurred.",
        "error",
        4200
      );
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  /* =========================================
     View controls
  ========================================= */

  function showHomeView() {
    elements.homeView?.classList.add("active-view");
    elements.lobbyView?.classList.remove("active-view");

    elements.bottomNavigation?.classList.remove(
      "lobby-navigation-hidden"
    );

    if (elements.headerSubtitle) {
      elements.headerSubtitle.textContent =
        "MTG Multiplayer Sandbox";
    }

    document.title = "Torn Commander Sandbox";

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function showLobbyView() {
    elements.homeView?.classList.remove("active-view");
    elements.lobbyView?.classList.add("active-view");

    elements.bottomNavigation?.classList.add(
      "lobby-navigation-hidden"
    );

    if (elements.headerSubtitle) {
      elements.headerSubtitle.textContent =
        "Commander Multiplayer Lobby";
    }

    document.title = state.room
      ? `Room ${state.room.code} | Torn Commander`
      : "Commander Lobby | Torn Commander";

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function setActiveNavigation(activeButton) {
    const navigationButtons = [
      elements.bottomHomeButton,
      elements.bottomDecksButton,
      elements.bottomGamesButton,
      elements.bottomSettingsButton
    ];

    navigationButtons.forEach((button) => {
      button?.classList.remove("active");
    });

    activeButton?.classList.add("active");
  }

  /* =========================================
     Modal controls
  ========================================= */

  function getModalById(modalId) {
    return document.getElementById(modalId);
  }

  function openModal(modal) {
    if (!modal) {
      return;
    }

    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");

    window.setTimeout(() => {
      const firstInput = modal.querySelector(
        "input:not([type='checkbox']), select, button"
      );

      firstInput?.focus();
    }, 40);
  }

  function closeModal(modal) {
    if (!modal) {
      return;
    }

    modal.classList.add("hidden");

    const visibleModal = document.querySelector(
      ".modal-backdrop:not(.hidden)"
    );

    if (!visibleModal) {
      document.body.classList.remove("modal-open");
    }
  }

  function closeAllModals() {
    document
      .querySelectorAll(".modal-backdrop")
      .forEach((modal) => {
        modal.classList.add("hidden");
      });

    document.body.classList.remove("modal-open");
  }

  /* =========================================
     URL and invitation helpers
  ========================================= */

  function createInviteLink(roomCode) {
    const url = new URL(window.location.href);

    url.search = "";
    url.hash = "";
    url.searchParams.set("room", roomCode);

    return url.toString();
  }

  function updateAddressRoomCode(roomCode) {
    const url = new URL(window.location.href);

    url.search = "";
    url.hash = "";

    if (roomCode) {
      url.searchParams.set("room", roomCode);
    }

    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}`
    );
  }

  async function copyText(text, successMessage) {
    try {
      if (
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        const temporaryInput =
          document.createElement("textarea");

        temporaryInput.value = text;
        temporaryInput.setAttribute("readonly", "");
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";

        document.body.appendChild(temporaryInput);
        temporaryInput.select();

        const successfulCopy =
          document.execCommand("copy");

        temporaryInput.remove();

        if (!successfulCopy) {
          throw new Error("Copy command failed.");
        }
      }

      showToast(successMessage, "success");
    } catch (error) {
      console.error("Unable to copy text:", error);

      showToast(
        "Unable to copy automatically. Please copy it manually.",
        "error",
        4200
      );
    }
  }

  async function shareCurrentRoom() {
    if (!state.room) {
      return;
    }

    const inviteLink = createInviteLink(state.room.code);

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Torn Commander Lobby",
          text:
            `Join my Commander game. ` +
            `Room code: ${state.room.code}`,
          url: inviteLink
        });

        return;
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.warn("Native share failed:", error);
      }
    }

    await copyText(
      inviteLink,
      "Room invitation link copied."
    );
  }

  /* =========================================
     Rejoin panel
  ========================================= */

  function updateRejoinPanel() {
    const savedSession = readRoomSession();

    if (!savedSession) {
      elements.rejoinPanel?.classList.add("hidden");
      return;
    }

    elements.rejoinPanel?.classList.remove("hidden");

    if (elements.rejoinRoomDetails) {
      const savedName =
        savedSession.playerName || "Player";

      elements.rejoinRoomDetails.textContent =
        `${savedName} • Room ${savedSession.roomCode}`;
    }
  }

  /* =========================================
     Room and player rendering
  ========================================= */

  function getCurrentPlayer() {
    if (!state.room || !Array.isArray(state.room.players)) {
      return null;
    }

    return state.room.players.find(
      (player) => player.id === state.playerId
    ) || null;
  }

  function isCurrentPlayerHost() {
    return Boolean(
      state.room &&
      state.room.hostId === state.playerId
    );
  }

  function renderPlayerList(players) {
    if (
      !elements.playerList ||
      !elements.playerRowTemplate
    ) {
      return;
    }

    elements.playerList.innerHTML = "";

    if (!Array.isArray(players) || players.length === 0) {
      const emptyState = document.createElement("div");

      emptyState.className = "empty-player-state";
      emptyState.innerHTML =
        "<span aria-hidden=\"true\">⌛</span>" +
        "<p>Waiting for players to join...</p>";

      elements.playerList.appendChild(emptyState);
      return;
    }

    players.forEach((player) => {
      const fragment =
        elements.playerRowTemplate.content.cloneNode(true);

      const row = fragment.querySelector(".player-row");
      const avatarLetter = fragment.querySelector(
        ".player-avatar-letter"
      );
      const playerName = fragment.querySelector(".player-name");
      const selfLabel = fragment.querySelector(
        ".player-self-label"
      );
      const hostLabel = fragment.querySelector(
        ".player-host-label"
      );
      const connectionText = fragment.querySelector(
        ".player-connection-text"
      );
      const readyState = fragment.querySelector(
        ".player-ready-state"
      );
      const readyIcon = fragment.querySelector(
        ".player-ready-icon"
      );
      const readyText = fragment.querySelector(
        ".player-ready-text"
      );
      const removeButton = fragment.querySelector(
        ".remove-player-button"
      );

      const isSelf = player.id === state.playerId;
      const isHost = player.id === state.room.hostId;
      const isReady = Boolean(player.ready);
      const isConnected = player.connected !== false;

      avatarLetter.textContent = getPlayerInitial(player.name);
      playerName.textContent = player.name;

      if (isSelf) {
        row.classList.add("is-self");
        selfLabel.classList.remove("hidden");
      }

      if (isHost) {
        hostLabel.classList.remove("hidden");
      }

      if (isReady) {
        row.classList.add("is-ready");

        readyState.classList.remove("waiting");
        readyState.classList.add("ready");

        readyIcon.textContent = "✓";
        readyText.textContent = "Ready";
      } else {
        readyState.classList.remove("ready");
        readyState.classList.add("waiting");

        readyIcon.textContent = "○";
        readyText.textContent = "Waiting";
      }

      connectionText.textContent = isConnected
        ? "Connected"
        : "Reconnecting…";

      if (
        isCurrentPlayerHost() &&
        !isSelf &&
        state.room.status !== "started"
      ) {
        removeButton.classList.remove("hidden");

        removeButton.setAttribute(
          "aria-label",
          `Remove ${player.name}`
        );

        removeButton.addEventListener("click", () => {
          removePlayerFromRoom(player);
        });
      }

      elements.playerList.appendChild(fragment);
    });
  }

  function renderLobbyStatus(
    playerCount,
    readyCount,
    roomStatus
  ) {
    if (roomStatus === "started") {
      elements.lobbyStatusText.textContent =
        "The Commander game has started.";

      elements.lobbyTitle.textContent = "Game Started";
      return;
    }

    elements.lobbyTitle.textContent =
      playerCount === 1
        ? "Waiting for players"
        : `${playerCount} players in lobby`;

    if (playerCount < 2) {
      elements.lobbyStatusText.textContent =
        "Waiting for at least two players.";
      return;
    }

    if (readyCount === playerCount) {
      elements.lobbyStatusText.textContent =
        "Everyone is ready to begin.";
      return;
    }

    const waitingCount = playerCount - readyCount;

    elements.lobbyStatusText.textContent =
      `${waitingCount} ${
        waitingCount === 1 ? "player is" : "players are"
      } not ready.`;
  }

  function renderReadyButton(currentPlayer, roomStatus) {
    if (!elements.readyButton) {
      return;
    }

    const isReady = Boolean(
      currentPlayer &&
      currentPlayer.ready
    );

    elements.readyButton.classList.toggle("ready", isReady);
    elements.readyButton.disabled =
      !currentPlayer ||
      roomStatus === "started";

    elements.readyButton.setAttribute(
      "aria-pressed",
      String(isReady)
    );

    if (roomStatus === "started") {
      elements.readyButtonIcon.textContent = "✓";
      elements.readyButtonText.textContent = "Game Started";
      return;
    }

    if (isReady) {
      elements.readyButtonIcon.textContent = "✓";
      elements.readyButtonText.textContent = "Ready";
    } else {
      elements.readyButtonIcon.textContent = "○";
      elements.readyButtonText.textContent = "Mark Ready";
    }
  }

  function renderHostControls(
    playerCount,
    readyCount,
    roomStatus
  ) {
    const isHost = isCurrentPlayerHost();

    elements.hostControlsPanel?.classList.toggle(
      "hidden",
      !isHost
    );

    if (!isHost) {
      return;
    }

    elements.hostMaxPlayersSelect.value =
      String(state.room.maxPlayers);

    elements.hostStartingLifeSelect.value =
      String(state.room.startingLife);

    const gameStarted = roomStatus === "started";
    const hasEnoughPlayers = playerCount >= 2;
    const everyoneReady =
      playerCount >= 2 &&
      readyCount === playerCount;

    elements.hostMaxPlayersSelect.disabled = gameStarted;
    elements.hostStartingLifeSelect.disabled = gameStarted;
    elements.saveRoomSettingsButton.disabled = gameStarted;

    elements.startGameButton.disabled =
      gameStarted ||
      !hasEnoughPlayers ||
      !everyoneReady;

    elements.startGameRequirement.classList.remove(
      "success"
    );

    if (gameStarted) {
      elements.startGameRequirement.textContent =
        "The Commander game has started.";

      elements.startGameRequirement.classList.add("success");
      return;
    }

    if (!hasEnoughPlayers) {
      elements.startGameRequirement.textContent =
        "At least two players must join.";
      return;
    }

    if (!everyoneReady) {
      elements.startGameRequirement.textContent =
        "Every player must mark themselves ready.";
      return;
    }

    elements.startGameRequirement.textContent =
      "Everyone is ready. You can start the game.";

    elements.startGameRequirement.classList.add("success");
  }

  function renderRoom(room) {
    if (
      !room ||
      typeof room.code !== "string" ||
      !Array.isArray(room.players)
    ) {
      return;
    }

    state.room = room;

    const currentPlayer = getCurrentPlayer();

    if (!currentPlayer) {
      clearRoomSession();
      showHomeView();

      showToast(
        "Your player session is no longer in this room.",
        "error",
        4200
      );

      return;
    }

    const playerCount = room.players.length;
    const readyCount = room.players.filter(
      (player) => player.ready
    ).length;

    elements.roomCodeDisplay.textContent = room.code;

    elements.playerCountDisplay.textContent =
      `${playerCount} / ${room.maxPlayers}`;

    elements.startingLifeDisplay.textContent =
      String(room.startingLife);

    elements.readyCountBadge.textContent =
      `${readyCount} ${
        readyCount === 1 ? "ready" : "ready"
      }`;

    renderLobbyStatus(
      playerCount,
      readyCount,
      room.status
    );

    renderPlayerList(room.players);
    renderReadyButton(currentPlayer, room.status);

    renderHostControls(
      playerCount,
      readyCount,
      room.status
    );

    saveRoomSession({
      roomCode: room.code,
      playerId: state.playerId,
      sessionToken: state.sessionToken,
      playerName: currentPlayer.name
    });

    saveTextValue(
      STORAGE_KEYS.playerName,
      currentPlayer.name
    );

    updateAddressRoomCode(room.code);
    showLobbyView();
  }

  /* =========================================
     Create room
  ========================================= */

  async function createRoom(event) {
    event.preventDefault();

    if (!requireServerConnection()) {
      return;
    }

    const playerName = normalizePlayerName(
      elements.createPlayerNameInput.value
    );

    if (playerName.length < 2) {
      showToast(
        "Enter a player name with at least two characters.",
        "error"
      );

      elements.createPlayerNameInput.focus();
      return;
    }

    await runButtonAction(
      elements.submitCreateRoomButton,
      "Creating Room…",
      async () => {
        const response = await emitWithAcknowledgement(
          "create-room",
          {
            playerName,
            maxPlayers: Number(
              elements.createMaxPlayersSelect.value
            ),
            startingLife: Number(
              elements.createStartingLifeSelect.value
            ),
            privateRoom:
              elements.privateRoomCheckbox.checked
          }
        );

        if (!response.success) {
          throw new Error(
            getErrorMessage(
              response,
              "Unable to create the Commander room."
            )
          );
        }

        state.playerId = response.playerId;
        state.sessionToken = response.sessionToken;

        saveTextValue(
          STORAGE_KEYS.playerName,
          playerName
        );

        closeModal(elements.createRoomModal);
        renderRoom(response.room);

        showToast(
          `Room ${response.room.code} created.`,
          "success"
        );
      }
    );
  }

  /* =========================================
     Join room
  ========================================= */

  async function joinRoom(event) {
    event.preventDefault();

    if (!requireServerConnection()) {
      return;
    }

    const playerName = normalizePlayerName(
      elements.joinPlayerNameInput.value
    );

    const roomCode = normalizeRoomCode(
      elements.joinRoomCodeInput.value
    );

    if (playerName.length < 2) {
      showToast(
        "Enter a player name with at least two characters.",
        "error"
      );

      elements.joinPlayerNameInput.focus();
      return;
    }

    if (roomCode.length !== 6) {
      showToast(
        "Enter the complete six-character room code.",
        "error"
      );

      elements.joinRoomCodeInput.focus();
      return;
    }

    await runButtonAction(
      elements.submitJoinRoomButton,
      "Joining Room…",
      async () => {
        const response = await emitWithAcknowledgement(
          "join-room",
          {
            playerName,
            roomCode
          }
        );

        if (!response.success) {
          throw new Error(
            getErrorMessage(
              response,
              "Unable to join the Commander room."
            )
          );
        }

        state.playerId = response.playerId;
        state.sessionToken = response.sessionToken;

        saveTextValue(
          STORAGE_KEYS.playerName,
          playerName
        );

        closeModal(elements.joinRoomModal);
        renderRoom(response.room);

        showToast(
          `Joined room ${response.room.code}.`,
          "success"
        );
      }
    );
  }

  /* =========================================
     Rejoin room
  ========================================= */

  async function attemptRoomRejoin({
    silent = false
  } = {}) {
    if (
      state.autoRejoinInProgress ||
      !isServerConnected()
    ) {
      return false;
    }

    const savedSession = readRoomSession();

    if (!savedSession) {
      return false;
    }

    state.autoRejoinInProgress = true;

    try {
      const response = await emitWithAcknowledgement(
        "rejoin-room",
        {
          roomCode: savedSession.roomCode,
          playerId: savedSession.playerId,
          sessionToken: savedSession.sessionToken,
          playerName: savedSession.playerName || ""
        }
      );

      if (!response.success) {
        clearRoomSession();

        if (!silent) {
          showToast(
            getErrorMessage(
              response,
              "The saved room is no longer available."
            ),
            "error",
            4200
          );
        }

        return false;
      }

      state.playerId = response.playerId;
      state.sessionToken = response.sessionToken;

      renderRoom(response.room);

      if (!silent) {
        showToast(
          `Rejoined room ${response.room.code}.`,
          "success"
        );
      }

      return true;
    } catch (error) {
      console.error("Automatic room rejoin failed:", error);

      if (!silent) {
        showToast(
          error.message ||
            "Unable to rejoin the saved room.",
          "error",
          4200
        );
      }

      return false;
    } finally {
      state.autoRejoinInProgress = false;
    }
  }

  /* =========================================
     Ready status
  ========================================= */

  async function toggleReadyStatus() {
    if (
      !state.room ||
      !requireServerConnection() ||
      elements.readyButton.disabled
    ) {
      return;
    }

    elements.readyButton.disabled = true;

    try {
      const response = await emitWithAcknowledgement(
        "toggle-ready",
        {
          roomCode: state.room.code,
          playerId: state.playerId,
          sessionToken: state.sessionToken
        }
      );

      if (!response.success) {
        throw new Error(
          getErrorMessage(
            response,
            "Unable to update your ready status."
          )
        );
      }

      renderRoom(response.room);
    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
          "Unable to update your ready status.",
        "error",
        4200
      );
    } finally {
      elements.readyButton.disabled = false;
    }
  }

  /* =========================================
     Host room settings
  ========================================= */

  async function saveRoomSettings() {
    if (
      !state.room ||
      !isCurrentPlayerHost() ||
      !requireServerConnection()
    ) {
      return;
    }

    await runButtonAction(
      elements.saveRoomSettingsButton,
      "Saving Settings…",
      async () => {
        const response = await emitWithAcknowledgement(
          "update-room-settings",
          {
            roomCode: state.room.code,
            playerId: state.playerId,
            sessionToken: state.sessionToken,
            maxPlayers: Number(
              elements.hostMaxPlayersSelect.value
            ),
            startingLife: Number(
              elements.hostStartingLifeSelect.value
            )
          }
        );

        if (!response.success) {
          throw new Error(
            getErrorMessage(
              response,
              "Unable to save the room settings."
            )
          );
        }

        renderRoom(response.room);

        showToast(
          "Room settings updated.",
          "success"
        );
      }
    );
  }

  async function startCommanderGame() {
    if (
      !state.room ||
      !isCurrentPlayerHost() ||
      !requireServerConnection()
    ) {
      return;
    }

    await runButtonAction(
      elements.startGameButton,
      "Starting Game…",
      async () => {
        const response = await emitWithAcknowledgement(
          "start-game",
          {
            roomCode: state.room.code,
            playerId: state.playerId,
            sessionToken: state.sessionToken
          }
        );

        if (!response.success) {
          throw new Error(
            getErrorMessage(
              response,
              "Unable to start the Commander game."
            )
          );
        }

        renderRoom(response.room);

        showToast(
          "Commander game started. The tabletop comes next.",
          "success",
          4800
        );
      }
    );
  }

  /* =========================================
     Remove a player
  ========================================= */

  async function removePlayerFromRoom(player) {
    if (
      !player ||
      !state.room ||
      !isCurrentPlayerHost()
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Remove ${player.name} from this lobby?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await emitWithAcknowledgement(
        "remove-player",
        {
          roomCode: state.room.code,
          playerId: state.playerId,
          sessionToken: state.sessionToken,
          targetPlayerId: player.id
        }
      );

      if (!response.success) {
        throw new Error(
          getErrorMessage(
            response,
            "Unable to remove that player."
          )
        );
      }

      renderRoom(response.room);

      showToast(
        `${player.name} was removed from the lobby.`,
        "success"
      );
    } catch (error) {
      console.error(error);

      showToast(
        error.message || "Unable to remove that player.",
        "error",
        4200
      );
    }
  }

  /* =========================================
     Leave room
  ========================================= */

  function finishLeavingRoom(message) {
    clearRoomSession();
    closeAllModals();
    updateAddressRoomCode("");
    showHomeView();
    setActiveNavigation(elements.bottomHomeButton);

    if (message) {
      showToast(message, "success");
    }
  }

  async function leaveCurrentRoom() {
    if (!state.room) {
      finishLeavingRoom();
      return;
    }

    const roomCode = state.room.code;

    elements.confirmLeaveRoomButton.disabled = true;
    elements.confirmLeaveRoomButton.textContent = "Leaving…";

    try {
      if (isServerConnected()) {
        const response = await emitWithAcknowledgement(
          "leave-room",
          {
            roomCode,
            playerId: state.playerId,
            sessionToken: state.sessionToken
          }
        );

        if (!response.success) {
          throw new Error(
            getErrorMessage(
              response,
              "Unable to leave the room."
            )
          );
        }
      }

      finishLeavingRoom(`Left room ${roomCode}.`);
    } catch (error) {
      console.error(error);

      showToast(
        error.message || "Unable to leave the room.",
        "error",
        4200
      );
    } finally {
      elements.confirmLeaveRoomButton.disabled = false;
      elements.confirmLeaveRoomButton.textContent =
        "Leave Room";
    }
  }

  /* =========================================
     Open forms
  ========================================= */

  function openCreateRoomForm() {
    if (!requireServerConnection()) {
      return;
    }

    const savedPlayerName = readTextValue(
      STORAGE_KEYS.playerName
    );

    if (savedPlayerName) {
      elements.createPlayerNameInput.value =
        savedPlayerName;
    }

    openModal(elements.createRoomModal);
  }

  function openJoinRoomForm() {
    const savedPlayerName = readTextValue(
      STORAGE_KEYS.playerName
    );

    if (savedPlayerName) {
      elements.joinPlayerNameInput.value =
        savedPlayerName;
    }

    openModal(elements.joinRoomModal);
  }

  /* =========================================
     Invite code from address
  ========================================= */

  function loadRoomCodeFromAddress() {
    const parameters = new URLSearchParams(
      window.location.search
    );

    const roomCode = normalizeRoomCode(
      parameters.get("room")
    );

    if (roomCode.length !== 6) {
      return;
    }

    elements.joinRoomCodeInput.value = roomCode;

    const savedSession = readRoomSession();

    if (
      !savedSession ||
      savedSession.roomCode !== roomCode
    ) {
      openJoinRoomForm();
      elements.joinRoomCodeInput.value = roomCode;
    }
  }

  /* =========================================
     Socket connection
  ========================================= */

  function connectToServer() {
    if (typeof window.io !== "function") {
      updateConnectionStatus("disconnected", "Offline");

      showToast(
        "The multiplayer connection library could not load.",
        "error",
        4800
      );

      return;
    }

    updateConnectionStatus("connecting", "Connecting");

    try {
      state.socket = window.io({
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 12000
      });
    } catch (error) {
      console.error("Socket connection failed:", error);

      updateConnectionStatus("disconnected", "Offline");

      showToast(
        "Unable to connect to the Commander server.",
        "error",
        4800
      );

      return;
    }

    state.socket.on("connect", async () => {
      console.info(
        "Connected to Commander server:",
        state.socket.id
      );

      updateConnectionStatus("connected", "Connected");

      const savedSession = readRoomSession();

      if (savedSession) {
        await attemptRoomRejoin({
          silent: true
        });
      }
    });

    state.socket.on("disconnect", (reason) => {
      console.warn(
        "Disconnected from Commander server:",
        reason
      );

      updateConnectionStatus(
        "disconnected",
        "Reconnecting"
      );

      if (state.room) {
        showToast(
          "Connection lost. Your room will reconnect automatically.",
          "error",
          3600
        );
      }
    });

    state.socket.io.on("reconnect_attempt", () => {
      updateConnectionStatus(
        "connecting",
        "Reconnecting"
      );
    });

    state.socket.io.on("reconnect", () => {
      updateConnectionStatus("connected", "Connected");

      showToast(
        "Reconnected to the Commander server.",
        "success"
      );
    });

    state.socket.on("connect_error", (error) => {
      console.error("Connection error:", error);

      updateConnectionStatus("disconnected", "Offline");
    });

    state.socket.on("room-updated", (room) => {
      if (
        !room ||
        !state.playerId ||
        (
          state.room &&
          state.room.code !== room.code
        )
      ) {
        return;
      }

      renderRoom(room);
    });

    state.socket.on("game-started", (payload) => {
      if (
        !payload ||
        !payload.room ||
        (
          state.room &&
          payload.room.code !== state.room.code
        )
      ) {
        return;
      }

      renderRoom(payload.room);

      showToast(
        "The host started the Commander game.",
        "success",
        4500
      );
    });

    state.socket.on("removed-from-room", (payload) => {
      const message =
        payload && payload.message
          ? payload.message
          : "You were removed from the Commander room.";

      clearRoomSession();
      closeAllModals();
      updateAddressRoomCode("");
      showHomeView();

      showToast(message, "error", 5000);
    });

    state.socket.on("room-closed", (payload) => {
      const message =
        payload && payload.message
          ? payload.message
          : "The Commander room was closed.";

      clearRoomSession();
      closeAllModals();
      updateAddressRoomCode("");
      showHomeView();

      showToast(message, "error", 5000);
    });

    state.socket.on("server-message", (payload) => {
      if (
        !payload ||
        typeof payload.message !== "string"
      ) {
        return;
      }

      showToast(
        payload.message,
        payload.type || "default"
      );
    });
  }

  /* =========================================
     Event listeners
  ========================================= */

  elements.createGameButton?.addEventListener(
    "click",
    openCreateRoomForm
  );

  elements.joinGameButton?.addEventListener(
    "click",
    openJoinRoomForm
  );

  elements.createRoomForm?.addEventListener(
    "submit",
    createRoom
  );

  elements.joinRoomForm?.addEventListener(
    "submit",
    joinRoom
  );

  elements.joinRoomCodeInput?.addEventListener(
    "input",
    () => {
      const normalizedCode = normalizeRoomCode(
        elements.joinRoomCodeInput.value
      );

      if (
        elements.joinRoomCodeInput.value !==
        normalizedCode
      ) {
        elements.joinRoomCodeInput.value =
          normalizedCode;
      }
    }
  );

  elements.readyButton?.addEventListener(
    "click",
    toggleReadyStatus
  );

  elements.saveRoomSettingsButton?.addEventListener(
    "click",
    saveRoomSettings
  );

  elements.startGameButton?.addEventListener(
    "click",
    startCommanderGame
  );

  elements.copyRoomCodeButton?.addEventListener(
    "click",
    () => {
      if (!state.room) {
        return;
      }

      copyText(
        state.room.code,
        "Room code copied."
      );
    }
  );

  elements.copyInviteLinkButton?.addEventListener(
    "click",
    () => {
      if (!state.room) {
        return;
      }

      copyText(
        createInviteLink(state.room.code),
        "Room invitation link copied."
      );
    }
  );

  elements.shareRoomButton?.addEventListener(
    "click",
    shareCurrentRoom
  );

  elements.leaveLobbyButton?.addEventListener(
    "click",
    () => {
      openModal(elements.leaveRoomModal);
    }
  );

  elements.cancelLeaveRoomButton?.addEventListener(
    "click",
    () => {
      closeModal(elements.leaveRoomModal);
    }
  );

  elements.confirmLeaveRoomButton?.addEventListener(
    "click",
    leaveCurrentRoom
  );

  elements.rejoinRoomButton?.addEventListener(
    "click",
    async () => {
      if (!requireServerConnection()) {
        return;
      }

      const rejoined = await attemptRoomRejoin({
        silent: false
      });

      if (!rejoined) {
        updateRejoinPanel();
      }
    }
  );

  elements.bottomHomeButton?.addEventListener(
    "click",
    () => {
      setActiveNavigation(elements.bottomHomeButton);
      showHomeView();
    }
  );

  const deckPlaceholderHandler = () => {
    setActiveNavigation(elements.bottomDecksButton);

    showToast(
      "Deck importing will be added after the lobby system."
    );
  };

  elements.myDecksButton?.addEventListener(
    "click",
    deckPlaceholderHandler
  );

  elements.bottomDecksButton?.addEventListener(
    "click",
    deckPlaceholderHandler
  );

  elements.bottomGamesButton?.addEventListener(
    "click",
    () => {
      setActiveNavigation(elements.bottomGamesButton);

      showToast(
        "Active and recent games will appear here later."
      );
    }
  );

  elements.bottomSettingsButton?.addEventListener(
    "click",
    () => {
      setActiveNavigation(elements.bottomSettingsButton);

      showToast(
        "Player and Torn settings will be added later."
      );
    }
  );

  document
    .querySelectorAll("[data-close-modal]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const modalId = button.getAttribute(
          "data-close-modal"
        );

        closeModal(getModalById(modalId));
      });
    });

  document
    .querySelectorAll(".modal-backdrop")
    .forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeModal(modal);
        }
      });
    });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    const visibleModal = document.querySelector(
      ".modal-backdrop:not(.hidden)"
    );

    if (visibleModal) {
      closeModal(visibleModal);
    }
  });

  window.addEventListener("error", (event) => {
    console.error(
      "Application error:",
      event.error || event.message
    );
  });

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      console.error(
        "Unhandled promise rejection:",
        event.reason
      );
    }
  );

  /* =========================================
     Initial setup
  ========================================= */

  const savedPlayerName = readTextValue(
    STORAGE_KEYS.playerName
  );

  if (savedPlayerName) {
    elements.createPlayerNameInput.value =
      savedPlayerName;

    elements.joinPlayerNameInput.value =
      savedPlayerName;
  }

  updateRejoinPanel();
  showHomeView();
  setActiveNavigation(elements.bottomHomeButton);
  loadRoomCodeFromAddress();
  connectToServer();
});
