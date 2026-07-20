"use strict";

/*
  Torn Commander Sandbox
  Step 3 frontend controller

  Features:
  - Step 2 multiplayer rooms
  - Local Commander deck importing
  - Saved deck library
  - Active deck selection
  - Commander and card-count tracking
  - Lobby deck synchronization
  - Ready-status deck requirement
  - Room reconnection
*/

document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEYS = {
    playerName: "tcs-player-name",
    roomSession: "tcs-room-session",
    decks: "tcs-commander-decks",
    activeDeckId: "tcs-active-deck-id"
  };

  const MAX_SAVED_DECKS = 30;

  const elements = {
    connectionStatus: document.getElementById("connectionStatus"),
    connectionText: document.getElementById("connectionText"),
    headerSubtitle: document.getElementById("headerSubtitle"),
    messageToast: document.getElementById("messageToast"),

    homeView: document.getElementById("homeView"),
    decksView: document.getElementById("decksView"),
    lobbyView: document.getElementById("lobbyView"),
    bottomNavigation: document.getElementById("bottomNavigation"),

    createGameButton: document.getElementById("createGameButton"),
    joinGameButton: document.getElementById("joinGameButton"),
    myDecksButton: document.getElementById("myDecksButton"),

    bottomHomeButton: document.getElementById("bottomHomeButton"),
    bottomDecksButton: document.getElementById("bottomDecksButton"),
    bottomGamesButton: document.getElementById("bottomGamesButton"),
    bottomSettingsButton: document.getElementById(
      "bottomSettingsButton"
    ),

    rejoinPanel: document.getElementById("rejoinPanel"),
    rejoinRoomDetails: document.getElementById(
      "rejoinRoomDetails"
    ),
    rejoinRoomButton: document.getElementById("rejoinRoomButton"),

    homeActiveDeckPanel: document.getElementById(
      "homeActiveDeckPanel"
    ),
    homeActiveDeckName: document.getElementById(
      "homeActiveDeckName"
    ),
    homeActiveCommanderName: document.getElementById(
      "homeActiveCommanderName"
    ),
    homeChangeDeckButton: document.getElementById(
      "homeChangeDeckButton"
    ),

    decksBackButton: document.getElementById("decksBackButton"),
    toolbarImportDeckButton: document.getElementById(
      "toolbarImportDeckButton"
    ),
    importDeckButton: document.getElementById("importDeckButton"),
    emptyImportDeckButton: document.getElementById(
      "emptyImportDeckButton"
    ),

    savedDeckCount: document.getElementById("savedDeckCount"),
    activeDeckStatus: document.getElementById("activeDeckStatus"),
    savedCardCount: document.getElementById("savedCardCount"),

    selectedDeckPanel: document.getElementById(
      "selectedDeckPanel"
    ),
    selectedDeckName: document.getElementById("selectedDeckName"),
    selectedDeckCommander: document.getElementById(
      "selectedDeckCommander"
    ),
    selectedDeckCardCount: document.getElementById(
      "selectedDeckCardCount"
    ),
    selectedDeckCommanderCount: document.getElementById(
      "selectedDeckCommanderCount"
    ),
    selectedDeckValidation: document.getElementById(
      "selectedDeckValidation"
    ),

    emptyDeckState: document.getElementById("emptyDeckState"),
    savedDeckList: document.getElementById("savedDeckList"),
    savedDeckTemplate: document.getElementById("savedDeckTemplate"),

    importDeckModal: document.getElementById("importDeckModal"),
    importDeckForm: document.getElementById("importDeckForm"),
    deckNameInput: document.getElementById("deckNameInput"),
    commanderNameInput: document.getElementById(
      "commanderNameInput"
    ),
    deckListInput: document.getElementById("deckListInput"),
    deckImportLineCount: document.getElementById(
      "deckImportLineCount"
    ),
    deckImportPreview: document.getElementById(
      "deckImportPreview"
    ),
    previewRecognizedCards: document.getElementById(
      "previewRecognizedCards"
    ),
    previewTotalCards: document.getElementById(
      "previewTotalCards"
    ),
    previewErrorCount: document.getElementById(
      "previewErrorCount"
    ),
    selectImportedDeckCheckbox: document.getElementById(
      "selectImportedDeckCheckbox"
    ),
    submitImportDeckButton: document.getElementById(
      "submitImportDeckButton"
    ),

    deckDetailsModal: document.getElementById("deckDetailsModal"),
    deckDetailsTitle: document.getElementById("deckDetailsTitle"),
    deckDetailsCommander: document.getElementById(
      "deckDetailsCommander"
    ),
    deckDetailsCardCount: document.getElementById(
      "deckDetailsCardCount"
    ),
    deckDetailsUniqueCount: document.getElementById(
      "deckDetailsUniqueCount"
    ),
    deckDetailsDate: document.getElementById("deckDetailsDate"),
    deckDetailsCardList: document.getElementById(
      "deckDetailsCardList"
    ),
    copyDeckListButton: document.getElementById(
      "copyDeckListButton"
    ),
    selectDeckButton: document.getElementById("selectDeckButton"),
    deleteDeckButton: document.getElementById("deleteDeckButton"),

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

    lobbyDeckSelection: document.getElementById(
      "lobbyDeckSelection"
    ),
    chooseLobbyDeckButton: document.getElementById(
      "chooseLobbyDeckButton"
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

    decks: [],
    activeDeckId: "",
    openDeckId: "",

    deckSelectionReturnView: null,
    deckSyncInProgress: false,
    autoRejoinInProgress: false,

    toastTimer: null
  };

  function saveTextValue(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
      return true;
    } catch (error) {
      console.warn("Unable to save local value:", error);
      return false;
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

  function saveJsonValue(key, value) {
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify(value)
      );

      return true;
    } catch (error) {
      console.warn("Unable to save local information:", error);
      return false;
    }
  }

  function readJsonValue(key, fallbackValue) {
    try {
      const storedValue = window.localStorage.getItem(key);

      if (!storedValue) {
        return fallbackValue;
      }

      return JSON.parse(storedValue);
    } catch (error) {
      console.warn("Unable to read local information:", error);
      return fallbackValue;
    }
  }

  function saveRoomSession(session) {
    saveJsonValue(
      STORAGE_KEYS.roomSession,
      session
    );

    updateRejoinPanel();
  }

  function readRoomSession() {
    const session = readJsonValue(
      STORAGE_KEYS.roomSession,
      null
    );

    if (
      !session ||
      typeof session.roomCode !== "string" ||
      typeof session.playerId !== "string" ||
      typeof session.sessionToken !== "string"
    ) {
      return null;
    }

    return session;
  }

  function clearRoomSession() {
    removeStoredValue(STORAGE_KEYS.roomSession);

    state.room = null;
    state.playerId = null;
    state.sessionToken = null;

    updateRejoinPanel();
  }

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

  function normalizeDeckName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50);
  }

  function normalizeCardName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150);
  }

  function getPlayerInitial(name) {
    const cleanedName = normalizePlayerName(name);

    if (!cleanedName) {
      return "P";
    }

    const firstCharacter = cleanedName.match(/[A-Za-z0-9]/);

    return firstCharacter
      ? firstCharacter[0].toUpperCase()
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

  function createUniqueId() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID === "function"
    ) {
      return window.crypto.randomUUID();
    }

    return (
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 12)
    );
  }

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

        resolve(
          response || {
            success: false,
            error: "The server returned an empty response."
          }
        );
      });
    });
  }

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

  function hideAllViews() {
    elements.homeView?.classList.remove("active-view");
    elements.decksView?.classList.remove("active-view");
    elements.lobbyView?.classList.remove("active-view");
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

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function showHomeView() {
    hideAllViews();

    elements.homeView?.classList.add("active-view");

    elements.bottomNavigation?.classList.remove(
      "lobby-navigation-hidden"
    );

    if (elements.headerSubtitle) {
      elements.headerSubtitle.textContent =
        "MTG Multiplayer Sandbox";
    }

    document.title = "Torn Commander Sandbox";

    setActiveNavigation(elements.bottomHomeButton);
    renderHomeActiveDeck();
    scrollToTop();
  }

  function showDecksView() {
    hideAllViews();

    elements.decksView?.classList.add("active-view");

    elements.bottomNavigation?.classList.remove(
      "lobby-navigation-hidden"
    );

    if (elements.headerSubtitle) {
      elements.headerSubtitle.textContent =
        "Commander Deck Library";
    }

    document.title = "My Decks | Torn Commander";

    setActiveNavigation(elements.bottomDecksButton);
    renderDeckLibrary();
    scrollToTop();
  }

  function showLobbyView() {
    hideAllViews();

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

    renderLobbyDeckSelection();
    scrollToTop();
  }

  function openDeckLibrary(returnView = null) {
    state.deckSelectionReturnView = returnView;
    showDecksView();
  }

  function returnFromDeckLibrary() {
    if (
      state.deckSelectionReturnView === "lobby" &&
      state.room
    ) {
      state.deckSelectionReturnView = null;
      showLobbyView();
      return;
    }

    state.deckSelectionReturnView = null;
    showHomeView();
  }

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
        "input:not([type='checkbox']), textarea, select, button"
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

        console.warn("Native sharing failed:", error);
      }
    }

    await copyText(
      inviteLink,
      "Room invitation link copied."
    );
  }

  function normalizeStoredCard(card) {
    if (!card || typeof card !== "object") {
      return null;
    }

    const quantity = Math.max(
      1,
      Math.floor(Number(card.quantity) || 1)
    );

    const name = normalizeCardName(card.name);

    if (!name) {
      return null;
    }

    return {
      quantity,
      name
    };
  }

  function normalizeStoredDeck(deck) {
    if (!deck || typeof deck !== "object") {
      return null;
    }

    const name = normalizeDeckName(deck.name);
    const commander = normalizeCardName(deck.commander);

    if (!name || !commander) {
      return null;
    }

    const cards = Array.isArray(deck.cards)
      ? deck.cards
          .map(normalizeStoredCard)
          .filter(Boolean)
      : [];

    const mainDeckCount = cards.reduce(
      (total, card) => total + card.quantity,
      0
    );

    return {
      id:
        typeof deck.id === "string" && deck.id
          ? deck.id
          : createUniqueId(),

      name,
      commander,
      cards,

      mainDeckCount,
      totalCards: mainDeckCount + 1,
      uniqueCards: cards.length + 1,

      importedAt:
        typeof deck.importedAt === "string"
          ? deck.importedAt
          : new Date().toISOString(),

      updatedAt:
        typeof deck.updatedAt === "string"
          ? deck.updatedAt
          : new Date().toISOString(),

      parseErrors: Array.isArray(deck.parseErrors)
        ? deck.parseErrors
            .map((value) => String(value))
            .slice(0, 50)
        : []
    };
  }

  function loadDecks() {
    const storedDecks = readJsonValue(
      STORAGE_KEYS.decks,
      []
    );

    state.decks = Array.isArray(storedDecks)
      ? storedDecks
          .map(normalizeStoredDeck)
          .filter(Boolean)
          .slice(0, MAX_SAVED_DECKS)
      : [];

    state.activeDeckId = readTextValue(
      STORAGE_KEYS.activeDeckId
    );

    if (
      state.activeDeckId &&
      !state.decks.some(
        (deck) => deck.id === state.activeDeckId
      )
    ) {
      state.activeDeckId = "";
      removeStoredValue(STORAGE_KEYS.activeDeckId);
    }

    saveDecks();
  }

  function saveDecks() {
    return saveJsonValue(
      STORAGE_KEYS.decks,
      state.decks
    );
  }

  function getDeckById(deckId) {
    return (
      state.decks.find(
        (deck) => deck.id === deckId
      ) || null
    );
  }

  function getActiveDeck() {
    return getDeckById(state.activeDeckId);
  }

  function saveActiveDeckId(deckId) {
    state.activeDeckId = deckId || "";

    if (state.activeDeckId) {
      saveTextValue(
        STORAGE_KEYS.activeDeckId,
        state.activeDeckId
      );
    } else {
      removeStoredValue(STORAGE_KEYS.activeDeckId);
    }
  }

  function getDeckValidation(deck) {
    if (!deck) {
      return {
        status: "missing",
        label: "Missing"
      };
    }

    if (deck.totalCards === 100) {
      return {
        status: "valid",
        label: "Ready"
      };
    }

    if (deck.totalCards < 100) {
      return {
        status: "warning",
        label: `${100 - deck.totalCards} short`
      };
    }

    return {
      status: "warning",
      label: `${deck.totalCards - 100} extra`
    };
  }

  function cleanImportedCardName(value) {
    let cardName = normalizeCardName(value);

    cardName = cardName
      .replace(/\s+\([^)]+\)\s+[A-Za-z0-9-]+$/i, "")
      .replace(/\s+\[[^\]]+\]\s*$/i, "")
      .replace(/\s+\*[A-Za-z]+\*\s*$/i, "")
      .trim();

    return normalizeCardName(cardName);
  }

  function parseDeckList(rawDeckList, commanderName = "") {
    const lines = String(rawDeckList || "").split(/\r?\n/);

    const cardMap = new Map();
    const errors = [];

    let recognizedLines = 0;
    let section = "main";

    const normalizedCommander =
      normalizeCardName(commanderName).toLowerCase();

    lines.forEach((originalLine, lineIndex) => {
      let line = String(originalLine || "")
        .replace(/^\s*[-•]\s*/, "")
        .trim();

      if (!line) {
        return;
      }

      if (
        line.startsWith("#") ||
        line.startsWith("//")
      ) {
        return;
      }

      const heading = line
        .replace(/:$/, "")
        .trim()
        .toLowerCase();

      if (
        [
          "commander",
          "commanders",
          "command zone"
        ].includes(heading)
      ) {
        section = "commander";
        return;
      }

      if (
        [
          "deck",
          "main",
          "main deck",
          "mainboard",
          "library"
        ].includes(heading)
      ) {
        section = "main";
        return;
      }

      if (
        [
          "sideboard",
          "maybeboard",
          "considering",
          "tokens",
          "companions"
        ].includes(heading)
      ) {
        section = "skip";
        return;
      }

      if (section === "skip") {
        return;
      }

      const match = line.match(
        /^(\d+)\s*(?:x|×)?\s+(.+)$/i
      );

      if (!match) {
        errors.push(
          `Line ${lineIndex + 1}: ${line.slice(0, 80)}`
        );

        return;
      }

      const quantity = Math.floor(Number(match[1]));
      const cardName = cleanImportedCardName(match[2]);

      if (
        !Number.isFinite(quantity) ||
        quantity < 1 ||
        quantity > 999 ||
        cardName.length < 1
      ) {
        errors.push(
          `Line ${lineIndex + 1}: ${line.slice(0, 80)}`
        );

        return;
      }

      if (section === "commander") {
        return;
      }

      const key = cardName.toLowerCase();

      const existingCard = cardMap.get(key);

      if (existingCard) {
        existingCard.quantity += quantity;
      } else {
        cardMap.set(key, {
          quantity,
          name: cardName
        });
      }

      recognizedLines += 1;
    });

    if (
      normalizedCommander &&
      cardMap.has(normalizedCommander)
    ) {
      const commanderCard =
        cardMap.get(normalizedCommander);

      commanderCard.quantity -= 1;

      if (commanderCard.quantity <= 0) {
        cardMap.delete(normalizedCommander);
      }
    }

    const cards = Array.from(cardMap.values())
      .filter((card) => card.quantity > 0)
      .sort((firstCard, secondCard) =>
        firstCard.name.localeCompare(secondCard.name)
      );

    const totalQuantity = cards.reduce(
      (total, card) => total + card.quantity,
      0
    );

    return {
      cards,
      totalQuantity,
      totalWithCommander:
        totalQuantity +
        (normalizedCommander ? 1 : 0),

      recognizedLines,
      errorLines: errors
    };
  }

  function updateDeckImportPreview() {
    const rawDeckList =
      elements.deckListInput?.value || "";

    const commanderName =
      elements.commanderNameInput?.value || "";

    const hasInput =
      rawDeckList.trim().length > 0 ||
      commanderName.trim().length > 0;

    if (!hasInput) {
      elements.deckImportPreview?.classList.add("hidden");

      if (elements.deckImportLineCount) {
        elements.deckImportLineCount.textContent =
          "Paste the 99 main-deck cards. Your commander is added separately.";
      }

      return;
    }

    const parsedDeck = parseDeckList(
      rawDeckList,
      commanderName
    );

    const cardCount = parsedDeck.totalWithCommander;

    let warningCount = parsedDeck.errorLines.length;

    if (
      commanderName.trim() &&
      cardCount !== 100
    ) {
      warningCount += 1;
    }

    elements.deckImportPreview?.classList.remove("hidden");

    elements.previewRecognizedCards.textContent =
      String(parsedDeck.cards.length);

    elements.previewTotalCards.textContent =
      String(cardCount);

    elements.previewErrorCount.textContent =
      String(warningCount);

    if (elements.deckImportLineCount) {
      if (!commanderName.trim()) {
        elements.deckImportLineCount.textContent =
          "Enter a commander to calculate the complete deck total.";
      } else if (cardCount === 100) {
        elements.deckImportLineCount.textContent =
          "Deck total: 100 cards including the commander.";
      } else {
        elements.deckImportLineCount.textContent =
          `Deck total: ${cardCount} cards including the commander.`;
      }
    }
  }

  function renderHomeActiveDeck() {
    const activeDeck = getActiveDeck();

    if (!activeDeck) {
      elements.homeActiveDeckPanel?.classList.add("hidden");
      return;
    }

    elements.homeActiveDeckPanel?.classList.remove("hidden");

    elements.homeActiveDeckName.textContent =
      activeDeck.name;

    elements.homeActiveCommanderName.textContent =
      `${activeDeck.commander} • ${activeDeck.totalCards} cards`;
  }

  function renderSelectedDeckPanel() {
    const activeDeck = getActiveDeck();

    if (!activeDeck) {
      elements.selectedDeckPanel?.classList.add("hidden");
      return;
    }

    const validation = getDeckValidation(activeDeck);

    elements.selectedDeckPanel?.classList.remove("hidden");

    elements.selectedDeckName.textContent =
      activeDeck.name;

    elements.selectedDeckCommander.textContent =
      activeDeck.commander;

    elements.selectedDeckCardCount.textContent =
      String(activeDeck.totalCards);

    elements.selectedDeckCommanderCount.textContent = "1";

    elements.selectedDeckValidation.textContent =
      validation.label;
  }

  function renderSavedDeckList() {
    if (
      !elements.savedDeckList ||
      !elements.savedDeckTemplate
    ) {
      return;
    }

    elements.savedDeckList.innerHTML = "";

    if (state.decks.length === 0) {
      elements.emptyDeckState?.classList.remove("hidden");
      elements.savedDeckList.classList.add("hidden");
      return;
    }

    elements.emptyDeckState?.classList.add("hidden");
    elements.savedDeckList.classList.remove("hidden");

    state.decks.forEach((deck) => {
      const fragment =
        elements.savedDeckTemplate.content.cloneNode(true);

      const card = fragment.querySelector(".saved-deck-card");
      const openButton = fragment.querySelector(
        ".saved-deck-open-button"
      );
      const deckName = fragment.querySelector(
        ".saved-deck-name"
      );
      const commanderName = fragment.querySelector(
        ".saved-deck-commander"
      );
      const cardCount = fragment.querySelector(
        ".saved-deck-count"
      );
      const validity = fragment.querySelector(
        ".saved-deck-validity"
      );
      const activeBadge = fragment.querySelector(
        ".saved-deck-selected-badge"
      );

      const validation = getDeckValidation(deck);
      const isActive = deck.id === state.activeDeckId;

      deckName.textContent = deck.name;
      commanderName.textContent = deck.commander;
      cardCount.textContent = `${deck.totalCards} cards`;
      validity.textContent = validation.label;

      validity.classList.remove("valid", "warning");
      validity.classList.add(validation.status);

      if (isActive) {
        card.classList.add("active");
        activeBadge.classList.remove("hidden");
      }

      openButton.addEventListener("click", () => {
        openDeckDetails(deck.id);
      });

      elements.savedDeckList.appendChild(fragment);
    });
  }

  function renderDeckSummary() {
    const activeDeck = getActiveDeck();

    const totalSavedCards = state.decks.reduce(
      (total, deck) => total + deck.totalCards,
      0
    );

    elements.savedDeckCount.textContent =
      String(state.decks.length);

    elements.activeDeckStatus.textContent =
      activeDeck
        ? activeDeck.name
        : "None";

    elements.savedCardCount.textContent =
      String(totalSavedCards);
  }

  function renderDeckLibrary() {
    renderDeckSummary();
    renderSelectedDeckPanel();
    renderSavedDeckList();
    renderHomeActiveDeck();
    renderLobbyDeckSelection();
  }

  function formatImportedDate(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    try {
      return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      }).format(date);
    } catch (error) {
      return date.toLocaleDateString();
    }
  }

  function createDeckExportText(deck) {
    if (!deck) {
      return "";
    }

    const lines = [
      "Commander",
      `1 ${deck.commander}`,
      "",
      "Deck"
    ];

    deck.cards.forEach((card) => {
      lines.push(
        `${card.quantity} ${card.name}`
      );
    });

    return lines.join("\n");
  }

  function renderDeckDetailsCardList(deck) {
    if (!elements.deckDetailsCardList) {
      return;
    }

    elements.deckDetailsCardList.innerHTML = "";

    const commanderRow = document.createElement("div");
    commanderRow.className = "deck-details-card-row";

    const commanderQuantity = document.createElement("span");
    commanderQuantity.className =
      "deck-details-card-quantity";
    commanderQuantity.textContent = "1";

    const commanderName = document.createElement("span");
    commanderName.className = "deck-details-card-name";
    commanderName.textContent = `👑 ${deck.commander}`;

    commanderRow.append(
      commanderQuantity,
      commanderName
    );

    elements.deckDetailsCardList.appendChild(
      commanderRow
    );

    if (deck.cards.length === 0) {
      const emptyState = document.createElement("p");

      emptyState.className = "deck-details-empty";
      emptyState.textContent =
        "No main-deck cards were recognized.";

      elements.deckDetailsCardList.appendChild(emptyState);
      return;
    }

    deck.cards.forEach((card) => {
      const row = document.createElement("div");
      row.className = "deck-details-card-row";

      const quantity = document.createElement("span");
      quantity.className = "deck-details-card-quantity";
      quantity.textContent = String(card.quantity);

      const cardName = document.createElement("span");
      cardName.className = "deck-details-card-name";
      cardName.textContent = card.name;

      row.append(quantity, cardName);

      elements.deckDetailsCardList.appendChild(row);
    });
  }

  function openDeckDetails(deckId) {
    const deck = getDeckById(deckId);

    if (!deck) {
      showToast(
        "That saved deck could not be found.",
        "error"
      );

      return;
    }

    state.openDeckId = deck.id;

    elements.deckDetailsTitle.textContent = deck.name;
    elements.deckDetailsCommander.textContent =
      deck.commander;

    elements.deckDetailsCardCount.textContent =
      String(deck.totalCards);

    elements.deckDetailsUniqueCount.textContent =
      String(deck.uniqueCards);

    elements.deckDetailsDate.textContent =
      formatImportedDate(deck.importedAt);

    const isActive = deck.id === state.activeDeckId;

    elements.selectDeckButton.disabled = isActive;
    elements.selectDeckButton.textContent = isActive
      ? "Selected Deck"
      : "Select This Deck";

    renderDeckDetailsCardList(deck);
    openModal(elements.deckDetailsModal);
  }

  function openDeckImporter() {
    if (state.decks.length >= MAX_SAVED_DECKS) {
      showToast(
        `You can save up to ${MAX_SAVED_DECKS} decks. Delete one before importing another.`,
        "error",
        4800
      );

      return;
    }

    elements.importDeckForm?.reset();

    if (elements.selectImportedDeckCheckbox) {
      elements.selectImportedDeckCheckbox.checked = true;
    }

    elements.deckImportPreview?.classList.add("hidden");

    elements.deckImportLineCount.textContent =
      "Paste the 99 main-deck cards. Your commander is added separately.";

    openModal(elements.importDeckModal);
  }

  async function importCommanderDeck(event) {
    event.preventDefault();

    const deckName = normalizeDeckName(
      elements.deckNameInput.value
    );

    const commander = normalizeCardName(
      elements.commanderNameInput.value
    );

    if (deckName.length < 2) {
      showToast(
        "Enter a deck name with at least two characters.",
        "error"
      );

      elements.deckNameInput.focus();
      return;
    }

    if (commander.length < 2) {
      showToast(
        "Enter the name of your commander.",
        "error"
      );

      elements.commanderNameInput.focus();
      return;
    }

    const parsedDeck = parseDeckList(
      elements.deckListInput.value,
      commander
    );

    if (parsedDeck.cards.length === 0) {
      showToast(
        "No main-deck cards were recognized.",
        "error",
        4200
      );

      elements.deckListInput.focus();
      return;
    }

    const timestamp = new Date().toISOString();

    const deck = normalizeStoredDeck({
      id: createUniqueId(),
      name: deckName,
      commander,
      cards: parsedDeck.cards,
      importedAt: timestamp,
      updatedAt: timestamp,
      parseErrors: parsedDeck.errorLines
    });

    if (!deck) {
      showToast(
        "The deck could not be imported.",
        "error"
      );

      return;
    }

    state.decks.unshift(deck);

    const shouldSelect =
      elements.selectImportedDeckCheckbox.checked ||
      !getActiveDeck();

    if (shouldSelect) {
      saveActiveDeckId(deck.id);
    }

    if (!saveDecks()) {
      state.decks = state.decks.filter(
        (savedDeck) => savedDeck.id !== deck.id
      );

      showToast(
        "The browser could not save this deck. Storage may be full.",
        "error",
        5000
      );

      return;
    }

    closeModal(elements.importDeckModal);
    renderDeckLibrary();

    if (
      shouldSelect &&
      state.room
    ) {
      await syncPlayerDeckWithRoom({
        silent: true
      });
    }

    const validation = getDeckValidation(deck);

    if (validation.status === "valid") {
      showToast(
        `${deck.name} imported with 100 cards.`,
        "success",
        4200
      );
    } else {
      showToast(
        `${deck.name} imported with ${deck.totalCards} cards. You can still use it as a sandbox deck.`,
        "success",
        5200
      );
    }
  }

  async function selectDeck(deckId) {
    const deck = getDeckById(deckId);

    if (!deck) {
      showToast(
        "That saved deck could not be found.",
        "error"
      );

      return;
    }

    saveActiveDeckId(deck.id);
    closeModal(elements.deckDetailsModal);
    renderDeckLibrary();

    if (state.room) {
      await syncPlayerDeckWithRoom({
        silent: false
      });
    }

    showToast(
      `${deck.name} is now your active deck.`,
      "success"
    );

    if (
      state.deckSelectionReturnView === "lobby" &&
      state.room
    ) {
      state.deckSelectionReturnView = null;
      showLobbyView();
    }
  }

  async function deleteDeck(deckId) {
    const deck = getDeckById(deckId);

    if (!deck) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${deck.name}" from your saved decks?`
    );

    if (!confirmed) {
      return;
    }

    const wasActive = deck.id === state.activeDeckId;

    state.decks = state.decks.filter(
      (savedDeck) => savedDeck.id !== deck.id
    );

    if (wasActive) {
      const nextDeck = state.decks[0] || null;

      saveActiveDeckId(
        nextDeck ? nextDeck.id : ""
      );
    }

    saveDecks();

    state.openDeckId = "";
    closeModal(elements.deckDetailsModal);
    renderDeckLibrary();

    if (
      wasActive &&
      state.room
    ) {
      await syncPlayerDeckWithRoom({
        silent: true
      });
    }

    showToast(
      `${deck.name} was deleted.`,
      "success"
    );
  }

  function getPlayerDeck(player) {
    if (!player || typeof player !== "object") {
      return null;
    }

    if (
      player.deck &&
      typeof player.deck === "object" &&
      player.deck.name
    ) {
      return player.deck;
    }

    if (player.deckName) {
      return {
        id: player.deckId || "",
        name: player.deckName,
        commander: player.commanderName || "",
        totalCards: Number(player.deckCardCount) || 0
      };
    }

    return null;
  }

  function playerHasDeck(player) {
    const deck = getPlayerDeck(player);

    return Boolean(
      deck &&
      typeof deck.name === "string" &&
      deck.name.trim()
    );
  }

  function renderLobbyDeckSelection() {
    if (!elements.lobbyDeckSelection) {
      return;
    }

    const activeDeck = getActiveDeck();

    elements.lobbyDeckSelection.innerHTML = "";

    const deckDisplay = document.createElement("div");

    if (activeDeck) {
      deckDisplay.className = "lobby-selected-deck";

      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "👑";

      const information = document.createElement("div");

      const deckName = document.createElement("strong");
      deckName.textContent = activeDeck.name;

      const commander = document.createElement("p");
      commander.textContent =
        `${activeDeck.commander} • ${activeDeck.totalCards} cards`;

      information.append(deckName, commander);
      deckDisplay.append(icon, information);
    } else {
      deckDisplay.className = "lobby-deck-placeholder";

      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "📚";

      const information = document.createElement("div");

      const title = document.createElement("strong");
      title.textContent = "No deck selected";

      const description = document.createElement("p");
      description.textContent =
        "Import or choose a deck before marking ready.";

      information.append(title, description);
      deckDisplay.append(icon, information);
    }

    const chooseButton = document.createElement("button");

    chooseButton.className =
      "secondary-button full-width-button";

    chooseButton.type = "button";

    chooseButton.textContent = activeDeck
      ? "Change Commander Deck"
      : "Choose Commander Deck";

    chooseButton.addEventListener("click", () => {
      openDeckLibrary("lobby");
    });

    elements.lobbyDeckSelection.append(
      deckDisplay,
      chooseButton
    );
  }

  function createPublicDeckMetadata(deck) {
    if (!deck) {
      return null;
    }

    const validation = getDeckValidation(deck);

    return {
      id: deck.id,
      name: deck.name,
      commander: deck.commander,
      totalCards: deck.totalCards,
      uniqueCards: deck.uniqueCards,
      validation: validation.status
    };
  }

  async function syncPlayerDeckWithRoom({
    silent = false
  } = {}) {
    if (
      !state.room ||
      state.room.status === "started" ||
      state.deckSyncInProgress
    ) {
      return false;
    }

    if (!isServerConnected()) {
      if (!silent) {
        showToast(
          "Reconnect to the server before changing your lobby deck.",
          "error"
        );
      }

      return false;
    }

    state.deckSyncInProgress = true;

    try {
      const activeDeck = getActiveDeck();

      const response = await emitWithAcknowledgement(
        "set-player-deck",
        {
          roomCode: state.room.code,
          playerId: state.playerId,
          sessionToken: state.sessionToken,
          deck: createPublicDeckMetadata(activeDeck)
        },
        5000
      );

      if (!response.success) {
        if (!silent) {
          showToast(
            getErrorMessage(
              response,
              "Unable to update your lobby deck."
            ),
            "error",
            4200
          );
        }

        return false;
      }

      if (response.room) {
        renderRoom(response.room);
      }

      return true;
    } catch (error) {
      console.warn("Deck synchronization failed:", error);

      if (!silent) {
        showToast(
          error.message ||
            "Unable to update your lobby deck.",
          "error",
          4200
        );
      }

      return false;
    } finally {
      state.deckSyncInProgress = false;
    }
  }

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

  function getCurrentPlayer() {
    if (
      !state.room ||
      !Array.isArray(state.room.players)
    ) {
      return null;
    }

    return (
      state.room.players.find(
        (player) => player.id === state.playerId
      ) || null
    );
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
      const playerDeckName = fragment.querySelector(
        ".player-deck-name"
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

      const playerDeck = getPlayerDeck(player);

      avatarLetter.textContent = getPlayerInitial(player.name);
      playerName.textContent = player.name;

      if (playerDeck) {
        playerDeckName.textContent =
          playerDeck.commander
            ? `${playerDeck.name} • ${playerDeck.commander}`
            : playerDeck.name;

        playerDeckName.classList.remove("no-deck");
      } else {
        playerDeckName.textContent = "No deck selected";
        playerDeckName.classList.add("no-deck");
      }

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
    players,
    readyCount,
    roomStatus
  ) {
    const playerCount = players.length;

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

    const playersWithoutDecks = players.filter(
      (player) => !playerHasDeck(player)
    );

    if (playersWithoutDecks.length > 0) {
      elements.lobbyStatusText.textContent =
        `${playersWithoutDecks.length} ${
          playersWithoutDecks.length === 1
            ? "player needs"
            : "players need"
        } to select a deck.`;

      return;
    }

    if (readyCount === playerCount) {
      elements.lobbyStatusText.textContent =
        "Everyone has a deck and is ready to begin.";
      return;
    }

    const waitingCount = playerCount - readyCount;

    elements.lobbyStatusText.textContent =
      `${waitingCount} ${
        waitingCount === 1
          ? "player is"
          : "players are"
      } not ready.`;
  }

  function renderReadyButton(currentPlayer, roomStatus) {
    if (!elements.readyButton) {
      return;
    }

    const activeDeck = getActiveDeck();

    const isReady = Boolean(
      currentPlayer &&
      currentPlayer.ready
    );

    elements.readyButton.classList.toggle("ready", isReady);

    elements.readyButton.setAttribute(
      "aria-pressed",
      String(isReady)
    );

    if (roomStatus === "started") {
      elements.readyButton.disabled = true;
      elements.readyButtonIcon.textContent = "✓";
      elements.readyButtonText.textContent = "Game Started";
      return;
    }

    if (!activeDeck) {
      elements.readyButton.disabled = true;
      elements.readyButtonIcon.textContent = "!";
      elements.readyButtonText.textContent =
        "Select a Deck First";

      return;
    }

    elements.readyButton.disabled = !currentPlayer;

    if (isReady) {
      elements.readyButtonIcon.textContent = "✓";
      elements.readyButtonText.textContent = "Ready";
    } else {
      elements.readyButtonIcon.textContent = "○";
      elements.readyButtonText.textContent = "Mark Ready";
    }
  }

  function renderHostControls(
    players,
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

    const playerCount = players.length;

    elements.hostMaxPlayersSelect.value =
      String(state.room.maxPlayers);

    elements.hostStartingLifeSelect.value =
      String(state.room.startingLife);

    const gameStarted = roomStatus === "started";
    const hasEnoughPlayers = playerCount >= 2;

    const everyPlayerHasDeck = players.every(
      playerHasDeck
    );

    const everyPlayerConnected = players.every(
      (player) => player.connected !== false
    );

    const everyoneReady =
      hasEnoughPlayers &&
      readyCount === playerCount;

    elements.hostMaxPlayersSelect.disabled = gameStarted;
    elements.hostStartingLifeSelect.disabled = gameStarted;
    elements.saveRoomSettingsButton.disabled = gameStarted;

    elements.startGameButton.disabled =
      gameStarted ||
      !hasEnoughPlayers ||
      !everyPlayerHasDeck ||
      !everyPlayerConnected ||
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

    if (!everyPlayerHasDeck) {
      elements.startGameRequirement.textContent =
        "Every player must select a Commander deck.";
      return;
    }

    if (!everyPlayerConnected) {
      elements.startGameRequirement.textContent =
        "Every player must reconnect before starting.";
      return;
    }

    if (!everyoneReady) {
      elements.startGameRequirement.textContent =
        "Every player must mark themselves ready.";
      return;
    }

    elements.startGameRequirement.textContent =
      "Everyone has a deck and is ready. You can start.";

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
      `${readyCount} ready`;

    renderLobbyStatus(
      room.players,
      readyCount,
      room.status
    );

    renderPlayerList(room.players);
    renderReadyButton(currentPlayer, room.status);

    renderHostControls(
      room.players,
      readyCount,
      room.status
    );

    renderLobbyDeckSelection();

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

        if (getActiveDeck()) {
          await syncPlayerDeckWithRoom({
            silent: true
          });
        }

        showToast(
          `Room ${response.room.code} created.`,
          "success"
        );
      }
    );
  }

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

        if (getActiveDeck()) {
          await syncPlayerDeckWithRoom({
            silent: true
          });
        }

        showToast(
          `Joined room ${response.room.code}.`,
          "success"
        );
      }
    );
  }

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

      if (getActiveDeck()) {
        await syncPlayerDeckWithRoom({
          silent: true
        });
      }

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

  async function toggleReadyStatus() {
    if (
      !state.room ||
      !requireServerConnection()
    ) {
      return;
    }

    const activeDeck = getActiveDeck();

    if (!activeDeck) {
      showToast(
        "Select a Commander deck before marking ready.",
        "error"
      );

      openDeckLibrary("lobby");
      return;
    }

    const currentPlayer = getCurrentPlayer();
    const roomDeck = getPlayerDeck(currentPlayer);

    if (
      !roomDeck ||
      roomDeck.id !== activeDeck.id
    ) {
      const synchronized =
        await syncPlayerDeckWithRoom({
          silent: false
        });

      if (!synchronized) {
        return;
      }
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
          "Commander game started. The tabletop is the next stage.",
          "success",
          4800
        );
      }
    );
  }

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

      if (response.room) {
        renderRoom(response.room);
      }

      showToast(
        `${player.name} was removed from the lobby.`,
        "success"
      );
    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
          "Unable to remove that player.",
        "error",
        4200
      );
    }
  }

  function finishLeavingRoom(message) {
    clearRoomSession();
    closeAllModals();
    updateAddressRoomCode("");

    state.deckSelectionReturnView = null;

    showHomeView();

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
        error.message ||
          "Unable to leave the room.",
        "error",
        4200
      );
    } finally {
      elements.confirmLeaveRoomButton.disabled = false;
      elements.confirmLeaveRoomButton.textContent =
        "Leave Room";
    }
  }

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

  elements.myDecksButton?.addEventListener(
    "click",
    () => {
      openDeckLibrary(null);
    }
  );

  elements.homeChangeDeckButton?.addEventListener(
    "click",
    () => {
      openDeckLibrary(null);
    }
  );

  elements.decksBackButton?.addEventListener(
    "click",
    returnFromDeckLibrary
  );

  [
    elements.toolbarImportDeckButton,
    elements.importDeckButton,
    elements.emptyImportDeckButton
  ].forEach((button) => {
    button?.addEventListener(
      "click",
      openDeckImporter
    );
  });

  elements.importDeckForm?.addEventListener(
    "submit",
    importCommanderDeck
  );

  elements.deckListInput?.addEventListener(
    "input",
    updateDeckImportPreview
  );

  elements.commanderNameInput?.addEventListener(
    "input",
    updateDeckImportPreview
  );

  elements.copyDeckListButton?.addEventListener(
    "click",
    () => {
      const deck = getDeckById(state.openDeckId);

      if (!deck) {
        return;
      }

      copyText(
        createDeckExportText(deck),
        "Deck list copied."
      );
    }
  );

  elements.selectDeckButton?.addEventListener(
    "click",
    async () => {
      await selectDeck(state.openDeckId);
    }
  );

  elements.deleteDeckButton?.addEventListener(
    "click",
    async () => {
      await deleteDeck(state.openDeckId);
    }
  );

  elements.chooseLobbyDeckButton?.addEventListener(
    "click",
    () => {
      openDeckLibrary("lobby");
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
      state.deckSelectionReturnView = null;
      showHomeView();
    }
  );

  elements.bottomDecksButton?.addEventListener(
    "click",
    () => {
      openDeckLibrary(null);
    }
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

  loadDecks();

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
  renderDeckLibrary();
  showHomeView();
  loadRoomCodeFromAddress();
  connectToServer();
});
