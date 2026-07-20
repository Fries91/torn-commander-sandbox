"use strict";

/*
  Torn Commander Sandbox
  Step 3 backend server

  Features:
  - Express hosting
  - Socket.IO multiplayer rooms
  - Six-character private room codes
  - Two to six players
  - Ready status and host controls
  - Saved-session reconnection
  - Public deck metadata syncing
  - Deck selection required before readying
  - Automatic abandoned-room cleanup

  Active rooms are stored in memory for now. A later step can
  move room and player information into persistent storage.
*/

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIRECTORY = path.join(__dirname, "public");

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARACTERS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const PLAYER_RECONNECT_GRACE_MS =
  10 * 60 * 1000;

const EMPTY_ROOM_MAX_AGE_MS =
  30 * 60 * 1000;

const ROOM_CLEANUP_INTERVAL_MS =
  5 * 60 * 1000;

const ALLOWED_MAX_PLAYERS =
  new Set([2, 3, 4, 5, 6]);

const ALLOWED_STARTING_LIFE =
  new Set([20, 30, 40, 50, 60]);

const ALLOWED_DECK_VALIDATION =
  new Set([
    "valid",
    "warning",
    "missing"
  ]);

const rooms = new Map();
const disconnectTimers = new Map();

/* ==========================================
   Socket.IO setup
========================================== */

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  },

  transports: [
    "websocket",
    "polling"
  ],

  pingTimeout: 20000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6
});

/* ==========================================
   Express setup
========================================== */

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb"
  })
);

app.use(
  express.static(
    PUBLIC_DIRECTORY,
    {
      extensions: ["html"],
      maxAge: 0,
      etag: true,

      setHeaders(response) {
        response.setHeader(
          "Cache-Control",
          "no-cache, no-store, must-revalidate"
        );
      }
    }
  )
);

/* ==========================================
   General helpers
========================================== */

function roomChannel(roomCode) {
  return `commander-room:${roomCode}`;
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
    .slice(0, ROOM_CODE_LENGTH);
}

function normalizeText(
  value,
  maximumLength
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function normalizeMaximumPlayers(value) {
  const parsedValue = Number(value);

  return ALLOWED_MAX_PLAYERS.has(
    parsedValue
  )
    ? parsedValue
    : 6;
}

function normalizeStartingLife(value) {
  const parsedValue = Number(value);

  return ALLOWED_STARTING_LIFE.has(
    parsedValue
  )
    ? parsedValue
    : 40;
}

function normalizeDeckMetadata(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return null;
  }

  const id = normalizeText(
    value.id,
    100
  );

  const name = normalizeText(
    value.name,
    50
  );

  const commander = normalizeText(
    value.commander,
    150
  );

  const totalCards = Math.max(
    0,
    Math.min(
      1000,
      Math.floor(
        Number(value.totalCards) || 0
      )
    )
  );

  const uniqueCards = Math.max(
    0,
    Math.min(
      1000,
      Math.floor(
        Number(value.uniqueCards) || 0
      )
    )
  );

  const requestedValidation =
    normalizeText(
      value.validation,
      20
    ).toLowerCase();

  const validation =
    ALLOWED_DECK_VALIDATION.has(
      requestedValidation
    )
      ? requestedValidation
      : totalCards === 100
        ? "valid"
        : "warning";

  if (
    !id ||
    !name ||
    !commander
  ) {
    return null;
  }

  return {
    id,
    name,
    commander,
    totalCards,
    uniqueCards,
    validation
  };
}

function createPlayerId() {
  return crypto.randomUUID();
}

function createSessionToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function createRoomCode() {
  for (
    let attempt = 0;
    attempt < 100;
    attempt += 1
  ) {
    let code = "";

    for (
      let index = 0;
      index < ROOM_CODE_LENGTH;
      index += 1
    ) {
      const characterIndex =
        crypto.randomInt(
          0,
          ROOM_CODE_CHARACTERS.length
        );

      code +=
        ROOM_CODE_CHARACTERS[
          characterIndex
        ];
    }

    if (!rooms.has(code)) {
      return code;
    }
  }

  throw new Error(
    "Unable to generate a unique room code."
  );
}

function createPublicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    ready: player.ready,
    connected: player.connected,
    joinedAt: player.joinedAt,

    deck: player.deck
      ? {
          id: player.deck.id,
          name: player.deck.name,
          commander:
            player.deck.commander,
          totalCards:
            player.deck.totalCards,
          uniqueCards:
            player.deck.uniqueCards,
          validation:
            player.deck.validation
        }
      : null
  };
}

function createPublicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    privateRoom: room.privateRoom,
    maxPlayers: room.maxPlayers,
    startingLife: room.startingLife,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    startedAt:
      room.startedAt || null,

    players:
      room.players.map(
        createPublicPlayer
      )
  };
}

function findPlayer(
  room,
  playerId
) {
  if (
    !room ||
    !Array.isArray(room.players)
  ) {
    return null;
  }

  return (
    room.players.find(
      (player) =>
        player.id === playerId
    ) || null
  );
}

function acknowledge(
  callback,
  response
) {
  if (
    typeof callback === "function"
  ) {
    callback(response);
  }
}

function emitRoomUpdate(room) {
  room.updatedAt =
    new Date().toISOString();

  io.to(
    roomChannel(room.code)
  ).emit(
    "room-updated",
    createPublicRoom(room)
  );
}

function clearDisconnectTimer(
  roomCode,
  playerId
) {
  const timerKey =
    `${roomCode}:${playerId}`;

  const timer =
    disconnectTimers.get(timerKey);

  if (!timer) {
    return;
  }

  clearTimeout(timer);
  disconnectTimers.delete(timerKey);
}

function transferHostIfNeeded(room) {
  if (
    !room ||
    room.players.length === 0
  ) {
    return;
  }

  const currentHost =
    findPlayer(
      room,
      room.hostId
    );

  if (
    currentHost &&
    currentHost.connected
  ) {
    return;
  }

  const nextHost =
    room.players.find(
      (player) => player.connected
    ) || room.players[0];

  room.hostId = nextHost.id;
}

function removeSocketRoomAssociation(
  socket
) {
  if (!socket) {
    return;
  }

  socket.data.roomCode = null;
  socket.data.playerId = null;
}

function detachSocketFromRoom(
  socket,
  roomCode
) {
  if (!socket) {
    return;
  }

  socket.leave(
    roomChannel(roomCode)
  );

  removeSocketRoomAssociation(
    socket
  );
}

function getAuthenticatedRoomPlayer(
  payload
) {
  const roomCode =
    normalizeRoomCode(
      payload &&
      payload.roomCode
    );

  const playerId =
    String(
      (
        payload &&
        payload.playerId
      ) || ""
    );

  const sessionToken =
    String(
      (
        payload &&
        payload.sessionToken
      ) || ""
    );

  if (
    roomCode.length !==
    ROOM_CODE_LENGTH
  ) {
    return {
      success: false,
      error:
        "The room code is invalid."
    };
  }

  const room =
    rooms.get(roomCode);

  if (!room) {
    return {
      success: false,
      error:
        "That Commander room no longer exists."
    };
  }

  const player =
    findPlayer(
      room,
      playerId
    );

  if (
    !player ||
    player.sessionToken !==
      sessionToken
  ) {
    return {
      success: false,
      error:
        "Your room session could not be verified."
    };
  }

  return {
    success: true,
    room,
    player
  };
}

function ensureHost(
  room,
  player
) {
  if (
    room.hostId !== player.id
  ) {
    return {
      success: false,
      error:
        "Only the room host can perform that action."
    };
  }

  return {
    success: true
  };
}

function joinSocketToPlayer(
  socket,
  room,
  player
) {
  if (
    socket.data.roomCode &&
    socket.data.roomCode !==
      room.code
  ) {
    socket.leave(
      roomChannel(
        socket.data.roomCode
      )
    );
  }

  socket.join(
    roomChannel(room.code)
  );

  socket.data.roomCode =
    room.code;

  socket.data.playerId =
    player.id;

  player.socketId =
    socket.id;

  player.connected = true;

  player.lastSeenAt =
    new Date().toISOString();

  clearDisconnectTimer(
    room.code,
    player.id
  );
}

function removePlayerFromRoom(
  room,
  playerId
) {
  const playerIndex =
    room.players.findIndex(
      (player) =>
        player.id === playerId
    );

  if (playerIndex === -1) {
    return null;
  }

  const [removedPlayer] =
    room.players.splice(
      playerIndex,
      1
    );

  clearDisconnectTimer(
    room.code,
    removedPlayer.id
  );

  if (
    room.players.length === 0
  ) {
    rooms.delete(room.code);

    return removedPlayer;
  }

  transferHostIfNeeded(room);
  emitRoomUpdate(room);

  return removedPlayer;
}

function scheduleDisconnectedPlayerCleanup(
  room,
  player
) {
  clearDisconnectTimer(
    room.code,
    player.id
  );

  const timerKey =
    `${room.code}:${player.id}`;

  const timer =
    setTimeout(() => {
      disconnectTimers.delete(
        timerKey
      );

      const currentRoom =
        rooms.get(room.code);

      if (!currentRoom) {
        return;
      }

      const currentPlayer =
        findPlayer(
          currentRoom,
          player.id
        );

      if (
        !currentPlayer ||
        currentPlayer.connected
      ) {
        return;
      }

      removePlayerFromRoom(
        currentRoom,
        currentPlayer.id
      );
    }, PLAYER_RECONNECT_GRACE_MS);

  timer.unref();

  disconnectTimers.set(
    timerKey,
    timer
  );
}

function handleUnexpectedSocketError(
  socket,
  error,
  callback
) {
  console.error(
    `Socket action failed for ${socket.id}:`,
    error
  );

  acknowledge(
    callback,
    {
      success: false,
      error:
        "An unexpected server error occurred."
    }
  );
}

/* ==========================================
   HTTP routes
========================================== */

app.get(
  "/api/health",
  (request, response) => {
    const activeLobbyPlayers =
      Array.from(
        rooms.values()
      ).reduce(
        (total, room) =>
          total +
          room.players.length,
        0
      );

    response
      .status(200)
      .json({
        success: true,
        status: "online",
        app:
          "Torn Commander Sandbox",
        step: 3,

        connectedSockets:
          io.engine.clientsCount,

        activeRooms:
          rooms.size,

        activeLobbyPlayers,

        timestamp:
          new Date().toISOString()
      });
  }
);

app.get(
  "/api",
  (request, response) => {
    response
      .status(200)
      .json({
        success: true,
        name:
          "Torn Commander Sandbox API",
        version: "3.0.0",
        step: 3
      });
  }
);

/* ==========================================
   Socket.IO room system
========================================== */

io.on(
  "connection",
  (socket) => {
    console.log(
      `Player connected: ${socket.id}`
    );

    socket.emit(
      "server-message",
      {
        type: "success",
        message:
          "Connected to the Commander server."
      }
    );

    /* --------------------------------------
       Create room
    -------------------------------------- */

    socket.on(
      "create-room",
      (payload, callback) => {
        try {
          if (
            socket.data.roomCode
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Leave your current room before creating another one."
              }
            );

            return;
          }

          const playerName =
            normalizePlayerName(
              payload &&
              payload.playerName
            );

          if (
            playerName.length < 2
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Enter a player name with at least two characters."
              }
            );

            return;
          }

          const roomCode =
            createRoomCode();

          const playerId =
            createPlayerId();

          const sessionToken =
            createSessionToken();

          const timestamp =
            new Date().toISOString();

          const player = {
            id: playerId,
            name: playerName,
            ready: false,
            connected: true,
            socketId: socket.id,
            sessionToken,
            deck: null,
            joinedAt: timestamp,
            lastSeenAt: timestamp
          };

          const room = {
            code: roomCode,
            hostId: playerId,

            privateRoom:
              payload &&
              payload.privateRoom !==
                false,

            maxPlayers:
              normalizeMaximumPlayers(
                payload &&
                payload.maxPlayers
              ),

            startingLife:
              normalizeStartingLife(
                payload &&
                payload.startingLife
              ),

            status: "waiting",
            createdAt: timestamp,
            updatedAt: timestamp,
            startedAt: null,
            players: [player]
          };

          rooms.set(
            roomCode,
            room
          );

          joinSocketToPlayer(
            socket,
            room,
            player
          );

          acknowledge(
            callback,
            {
              success: true,
              playerId,
              sessionToken,

              room:
                createPublicRoom(
                  room
                )
            }
          );

          console.log(
            `Room ${roomCode} created by ${playerName}`
          );
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Join room
    -------------------------------------- */

    socket.on(
      "join-room",
      (payload, callback) => {
        try {
          if (
            socket.data.roomCode
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Leave your current room before joining another one."
              }
            );

            return;
          }

          const playerName =
            normalizePlayerName(
              payload &&
              payload.playerName
            );

          const roomCode =
            normalizeRoomCode(
              payload &&
              payload.roomCode
            );

          if (
            playerName.length < 2
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Enter a player name with at least two characters."
              }
            );

            return;
          }

          if (
            roomCode.length !==
            ROOM_CODE_LENGTH
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Enter the complete six-character room code."
              }
            );

            return;
          }

          const room =
            rooms.get(roomCode);

          if (!room) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "No Commander room was found with that code."
              }
            );

            return;
          }

          if (
            room.status !== "waiting"
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "That Commander game has already started."
              }
            );

            return;
          }

          if (
            room.players.length >=
            room.maxPlayers
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "That Commander room is full."
              }
            );

            return;
          }

          const duplicateName =
            room.players.some(
              (player) =>
                player.name
                  .toLowerCase() ===
                playerName
                  .toLowerCase()
            );

          if (duplicateName) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "That player name is already being used in this room. " +
                  "Use Rejoin Room if it is your saved session."
              }
            );

            return;
          }

          const playerId =
            createPlayerId();

          const sessionToken =
            createSessionToken();

          const timestamp =
            new Date().toISOString();

          const player = {
            id: playerId,
            name: playerName,
            ready: false,
            connected: true,
            socketId: socket.id,
            sessionToken,
            deck: null,
            joinedAt: timestamp,
            lastSeenAt: timestamp
          };

          room.players.push(player);

          joinSocketToPlayer(
            socket,
            room,
            player
          );

          acknowledge(
            callback,
            {
              success: true,
              playerId,
              sessionToken,

              room:
                createPublicRoom(
                  room
                )
            }
          );

          emitRoomUpdate(room);

          console.log(
            `${playerName} joined room ${roomCode}`
          );
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Rejoin room
    -------------------------------------- */

    socket.on(
      "rejoin-room",
      (payload, callback) => {
        try {
          const authentication =
            getAuthenticatedRoomPlayer(
              payload
            );

          if (
            !authentication.success
          ) {
            acknowledge(
              callback,
              authentication
            );

            return;
          }

          const {
            room,
            player
          } = authentication;

          const previousSocketId =
            player.socketId;

          if (
            previousSocketId &&
            previousSocketId !==
              socket.id
          ) {
            const previousSocket =
              io.sockets.sockets.get(
                previousSocketId
              );

            if (previousSocket) {
              previousSocket.emit(
                "removed-from-room",
                {
                  message:
                    "This room session was opened on another device."
                }
              );

              detachSocketFromRoom(
                previousSocket,
                room.code
              );
            }
          }

          const suppliedName =
            normalizePlayerName(
              payload &&
              payload.playerName
            );

          if (
            suppliedName.length >= 2
          ) {
            const duplicateName =
              room.players.some(
                (otherPlayer) =>
                  otherPlayer.id !==
                    player.id &&
                  otherPlayer.name
                    .toLowerCase() ===
                    suppliedName
                      .toLowerCase()
              );

            if (!duplicateName) {
              player.name =
                suppliedName;
            }
          }

          joinSocketToPlayer(
            socket,
            room,
            player
          );

          acknowledge(
            callback,
            {
              success: true,
              playerId: player.id,

              sessionToken:
                player.sessionToken,

              room:
                createPublicRoom(
                  room
                )
            }
          );

          emitRoomUpdate(room);

          console.log(
            `${player.name} rejoined room ${room.code}`
          );
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Set or clear player deck
    -------------------------------------- */

    socket.on(
      "set-player-deck",
      (payload, callback) => {
        try {
          const authentication =
            getAuthenticatedRoomPlayer(
              payload
            );

          if (
            !authentication.success
          ) {
            acknowledge(
              callback,
              authentication
            );

            return;
          }

          const {
            room,
            player
          } = authentication;

          if (
            room.status !== "waiting"
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Deck selection cannot change after the game starts."
              }
            );

            return;
          }

          const requestedDeck =
            payload
              ? payload.deck
              : null;

          if (
            requestedDeck === null
          ) {
            player.deck = null;
            player.ready = false;

            player.lastSeenAt =
              new Date().toISOString();

            acknowledge(
              callback,
              {
                success: true,

                room:
                  createPublicRoom(
                    room
                  )
              }
            );

            emitRoomUpdate(room);

            return;
          }

          const deck =
            normalizeDeckMetadata(
              requestedDeck
            );

          if (!deck) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "The selected deck information is incomplete."
              }
            );

            return;
          }

          const deckChanged =
            !player.deck ||
            player.deck.id !==
              deck.id ||
            player.deck.name !==
              deck.name ||
            player.deck.commander !==
              deck.commander ||
            player.deck.totalCards !==
              deck.totalCards;

          player.deck = deck;

          player.lastSeenAt =
            new Date().toISOString();

          if (deckChanged) {
            player.ready = false;
          }

          acknowledge(
            callback,
            {
              success: true,

              room:
                createPublicRoom(
                  room
                )
            }
          );

          emitRoomUpdate(room);
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Ready status
    -------------------------------------- */

    socket.on(
      "toggle-ready",
      (payload, callback) => {
        try {
          const authentication =
            getAuthenticatedRoomPlayer(
              payload
            );

          if (
            !authentication.success
          ) {
            acknowledge(
              callback,
              authentication
            );

            return;
          }

          const {
            room,
            player
          } = authentication;

          if (
            room.status !== "waiting"
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Ready status cannot change after the game starts."
              }
            );

            return;
          }

          if (!player.connected) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Reconnect to the room before changing status."
              }
            );

            return;
          }

          if (
            !player.ready &&
            !player.deck
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Select a Commander deck before marking ready."
              }
            );

            return;
          }

          player.ready =
            !player.ready;

          player.lastSeenAt =
            new Date().toISOString();

          acknowledge(
            callback,
            {
              success: true,

              room:
                createPublicRoom(
                  room
                )
            }
          );

          emitRoomUpdate(room);
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Host room settings
    -------------------------------------- */

    socket.on(
      "update-room-settings",
      (payload, callback) => {
        try {
          const authentication =
            getAuthenticatedRoomPlayer(
              payload
            );

          if (
            !authentication.success
          ) {
            acknowledge(
              callback,
              authentication
            );

            return;
          }

          const {
            room,
            player
          } = authentication;

          const hostCheck =
            ensureHost(
              room,
              player
            );

          if (
            !hostCheck.success
          ) {
            acknowledge(
              callback,
              hostCheck
            );

            return;
          }

          if (
            room.status !== "waiting"
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Room settings cannot change after the game starts."
              }
            );

            return;
          }

          const maximumPlayers =
            normalizeMaximumPlayers(
              payload &&
              payload.maxPlayers
            );

          if (
            maximumPlayers <
            room.players.length
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  `The room already has ${room.players.length} players. ` +
                  "Choose a larger maximum."
              }
            );

            return;
          }

          room.maxPlayers =
            maximumPlayers;

          room.startingLife =
            normalizeStartingLife(
              payload &&
              payload.startingLife
            );

          acknowledge(
            callback,
            {
              success: true,

              room:
                createPublicRoom(
                  room
                )
            }
          );

          emitRoomUpdate(room);
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Start game
    -------------------------------------- */

    socket.on(
      "start-game",
      (payload, callback) => {
        try {
          const authentication =
            getAuthenticatedRoomPlayer(
              payload
            );

          if (
            !authentication.success
          ) {
            acknowledge(
              callback,
              authentication
            );

            return;
          }

          const {
            room,
            player
          } = authentication;

          const hostCheck =
            ensureHost(
              room,
              player
            );

          if (
            !hostCheck.success
          ) {
            acknowledge(
              callback,
              hostCheck
            );

            return;
          }

          if (
            room.status !== "waiting"
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "This Commander game has already started."
              }
            );

            return;
          }

          if (
            room.players.length < 2
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "At least two players are required to start."
              }
            );

            return;
          }

          const disconnectedPlayer =
            room.players.find(
              (roomPlayer) =>
                !roomPlayer.connected
            );

          if (disconnectedPlayer) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  `${disconnectedPlayer.name} must reconnect ` +
                  "before the game can start."
              }
            );

            return;
          }

          const playerWithoutDeck =
            room.players.find(
              (roomPlayer) =>
                !roomPlayer.deck
            );

          if (playerWithoutDeck) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  `${playerWithoutDeck.name} must select a ` +
                  "Commander deck before the game can start."
              }
            );

            return;
          }

          const unreadyPlayer =
            room.players.find(
              (roomPlayer) =>
                !roomPlayer.ready
            );

          if (unreadyPlayer) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  `${unreadyPlayer.name} must mark ready ` +
                  "before the game can start."
              }
            );

            return;
          }

          room.status = "started";

          room.startedAt =
            new Date().toISOString();

          room.updatedAt =
            room.startedAt;

          const publicRoom =
            createPublicRoom(room);

          acknowledge(
            callback,
            {
              success: true,
              room: publicRoom
            }
          );

          io.to(
            roomChannel(room.code)
          ).emit(
            "game-started",
            {
              room: publicRoom
            }
          );

          console.log(
            `Game started in room ${room.code}`
          );
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Remove player
    -------------------------------------- */

    socket.on(
      "remove-player",
      (payload, callback) => {
        try {
          const authentication =
            getAuthenticatedRoomPlayer(
              payload
            );

          if (
            !authentication.success
          ) {
            acknowledge(
              callback,
              authentication
            );

            return;
          }

          const {
            room,
            player
          } = authentication;

          const hostCheck =
            ensureHost(
              room,
              player
            );

          if (
            !hostCheck.success
          ) {
            acknowledge(
              callback,
              hostCheck
            );

            return;
          }

          if (
            room.status !== "waiting"
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "Players cannot be removed after the game starts."
              }
            );

            return;
          }

          const targetPlayerId =
            String(
              (
                payload &&
                payload.targetPlayerId
              ) || ""
            );

          if (
            !targetPlayerId ||
            targetPlayerId ===
              player.id
          ) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "The host cannot remove themselves."
              }
            );

            return;
          }

          const targetPlayer =
            findPlayer(
              room,
              targetPlayerId
            );

          if (!targetPlayer) {
            acknowledge(
              callback,
              {
                success: false,
                error:
                  "That player is no longer in the room."
              }
            );

            return;
          }

          const targetSocket =
            targetPlayer.socketId
              ? io.sockets.sockets.get(
                  targetPlayer.socketId
                )
              : null;

          if (targetSocket) {
            targetSocket.emit(
              "removed-from-room",
              {
                message:
                  `You were removed from room ${room.code} by the host.`
              }
            );

            detachSocketFromRoom(
              targetSocket,
              room.code
            );
          }

          removePlayerFromRoom(
            room,
            targetPlayer.id
          );

          acknowledge(
            callback,
            {
              success: true,

              room:
                rooms.has(room.code)
                  ? createPublicRoom(
                      room
                    )
                  : null
            }
          );

          console.log(
            `${targetPlayer.name} was removed from room ${room.code}`
          );
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Leave room
    -------------------------------------- */

    socket.on(
      "leave-room",
      (payload, callback) => {
        try {
          const authentication =
            getAuthenticatedRoomPlayer(
              payload
            );

          if (
            !authentication.success
          ) {
            acknowledge(
              callback,
              authentication
            );

            return;
          }

          const {
            room,
            player
          } = authentication;

          detachSocketFromRoom(
            socket,
            room.code
          );

          removePlayerFromRoom(
            room,
            player.id
          );

          acknowledge(
            callback,
            {
              success: true
            }
          );

          console.log(
            `${player.name} left room ${room.code}`
          );
        } catch (error) {
          handleUnexpectedSocketError(
            socket,
            error,
            callback
          );
        }
      }
    );

    /* --------------------------------------
       Connection test
    -------------------------------------- */

    socket.on(
      "connection-test",
      (callback) => {
        acknowledge(
          callback,
          {
            success: true,
            socketId: socket.id,

            timestamp:
              new Date().toISOString()
          }
        );
      }
    );

    /* --------------------------------------
       Disconnection handling
    -------------------------------------- */

    socket.on(
      "disconnect",
      (reason) => {
        console.log(
          `Player disconnected: ${socket.id}. Reason: ${reason}`
        );

        const roomCode =
          socket.data.roomCode;

        const playerId =
          socket.data.playerId;

        if (
          !roomCode ||
          !playerId
        ) {
          return;
        }

        const room =
          rooms.get(roomCode);

        const player =
          findPlayer(
            room,
            playerId
          );

        if (
          !room ||
          !player ||
          player.socketId !==
            socket.id
        ) {
          return;
        }

        player.connected = false;
        player.ready = false;

        player.lastSeenAt =
          new Date().toISOString();

        transferHostIfNeeded(room);
        emitRoomUpdate(room);

        scheduleDisconnectedPlayerCleanup(
          room,
          player
        );
      }
    );

    socket.on(
      "error",
      (error) => {
        console.error(
          `Socket error for ${socket.id}:`,
          error
        );
      }
    );
  }
);

/* ==========================================
   Abandoned-room cleanup
========================================== */

const roomCleanupInterval =
  setInterval(() => {
    const now = Date.now();

    for (
      const [roomCode, room]
      of rooms.entries()
    ) {
      const hasConnectedPlayer =
        room.players.some(
          (player) =>
            player.connected
        );

      const updatedTime =
        Date.parse(
          room.updatedAt
        );

      const roomAge =
        Number.isFinite(
          updatedTime
        )
          ? now - updatedTime
          : 0;

      if (
        !hasConnectedPlayer &&
        roomAge >=
          EMPTY_ROOM_MAX_AGE_MS
      ) {
        room.players.forEach(
          (player) => {
            clearDisconnectTimer(
              roomCode,
              player.id
            );
          }
        );

        rooms.delete(roomCode);

        console.log(
          `Removed abandoned room ${roomCode}`
        );
      }
    }
  }, ROOM_CLEANUP_INTERVAL_MS);

roomCleanupInterval.unref();

/* ==========================================
   Browser route fallback
========================================== */

app.get(
  "*",
  (request, response, next) => {
    if (
      request.path.startsWith(
        "/api/"
      )
    ) {
      return next();
    }

    response.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    return response.sendFile(
      path.join(
        PUBLIC_DIRECTORY,
        "index.html"
      )
    );
  }
);

/* ==========================================
   Missing API route
========================================== */

app.use(
  "/api",
  (request, response) => {
    response
      .status(404)
      .json({
        success: false,
        error:
          "API route not found."
      });
  }
);

/* ==========================================
   Express error handler
========================================== */

app.use(
  (
    error,
    request,
    response,
    next
  ) => {
    console.error(
      "Server error:",
      error
    );

    if (
      response.headersSent
    ) {
      return next(error);
    }

    return response
      .status(500)
      .json({
        success: false,
        error:
          "An unexpected server error occurred."
      });
  }
);

/* ==========================================
   Start server
========================================== */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "-----------------------------------------"
    );

    console.log(
      "Torn Commander Sandbox Step 3 is running"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Local address: http://localhost:${PORT}`
    );

    console.log(
      "-----------------------------------------"
    );
  }
);

/* ==========================================
   Graceful shutdown
========================================== */

function shutdownServer(signal) {
  console.log(
    `${signal} received. Closing server...`
  );

  clearInterval(
    roomCleanupInterval
  );

  for (
    const timer
    of disconnectTimers.values()
  ) {
    clearTimeout(timer);
  }

  disconnectTimers.clear();

  io.close(() => {
    server.close(() => {
      console.log(
        "Commander server closed."
      );

      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error(
      "Forced server shutdown."
    );

    process.exit(1);
  }, 10000).unref();
}

process.on(
  "SIGTERM",
  () => {
    shutdownServer("SIGTERM");
  }
);

process.on(
  "SIGINT",
  () => {
    shutdownServer("SIGINT");
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "Unhandled rejection:",
      reason
    );
  }
);
