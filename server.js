"use strict";

/*
  Torn Commander Sandbox
  Step 1 backend server

  This server handles:
  - Hosting the frontend files
  - Socket.IO multiplayer connections
  - Health checks for Render
  - Basic connection and disconnection logging
*/

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIRECTORY = path.join(__dirname, "public");

/*
  Create the Socket.IO multiplayer server.
*/
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  },

  transports: ["websocket", "polling"],

  pingTimeout: 20000,
  pingInterval: 25000
});

/*
  Allow Express to understand JSON requests.
*/
app.use(express.json({
  limit: "1mb"
}));

app.use(express.urlencoded({
  extended: true,
  limit: "1mb"
}));

/*
  Serve the frontend files from the public folder.
*/
app.use(express.static(PUBLIC_DIRECTORY, {
  extensions: ["html"],
  maxAge: process.env.NODE_ENV === "production"
    ? "1h"
    : 0
}));

/*
  Health-check route.

  Render can use this route to confirm that the
  Commander server is online.
*/
app.get("/api/health", (request, response) => {
  response.status(200).json({
    success: true,
    status: "online",
    app: "Torn Commander Sandbox",
    connectedPlayers: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

/*
  Basic API information route.
*/
app.get("/api", (request, response) => {
  response.status(200).json({
    success: true,
    name: "Torn Commander Sandbox API",
    version: "1.0.0",
    step: 1
  });
});

/*
  Socket.IO player connections.
*/
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  /*
    Send a welcome message to the newly connected player.
  */
  socket.emit("server-message", {
    type: "success",
    message: "Connected to the Commander server."
  });

  /*
    Simple connection test for future development.
  */
  socket.on("connection-test", (callback) => {
    const response = {
      success: true,
      socketId: socket.id,
      timestamp: new Date().toISOString()
    };

    if (typeof callback === "function") {
      callback(response);
    }
  });

  /*
    Log player disconnections.
  */
  socket.on("disconnect", (reason) => {
    console.log(
      `Player disconnected: ${socket.id}. Reason: ${reason}`
    );
  });

  /*
    Catch socket-level errors without crashing the server.
  */
  socket.on("error", (error) => {
    console.error(
      `Socket error for ${socket.id}:`,
      error
    );
  });
});

/*
  Return the main application for browser routes that
  are not API requests.

  This will become important later when we add lobby,
  deck and game-table pages.
*/
app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api/")) {
    return next();
  }

  return response.sendFile(
    path.join(PUBLIC_DIRECTORY, "index.html")
  );
});

/*
  API route-not-found response.
*/
app.use("/api", (request, response) => {
  response.status(404).json({
    success: false,
    error: "API route not found."
  });
});

/*
  General Express error handler.
*/
app.use((error, request, response, next) => {
  console.error("Server error:", error);

  if (response.headersSent) {
    return next(error);
  }

  return response.status(500).json({
    success: false,
    error: "An unexpected server error occurred."
  });
});

/*
  Start the application.
*/
server.listen(PORT, "0.0.0.0", () => {
  console.log("-----------------------------------------");
  console.log("Torn Commander Sandbox is running");
  console.log(`Port: ${PORT}`);
  console.log(`Local address: http://localhost:${PORT}`);
  console.log("-----------------------------------------");
});

/*
  Shut down cleanly when Render or another host
  restarts the application.
*/
function shutdownServer(signal) {
  console.log(`${signal} received. Closing server...`);

  io.close(() => {
    server.close(() => {
      console.log("Commander server closed.");
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error("Forced server shutdown.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => {
  shutdownServer("SIGTERM");
});

process.on("SIGINT", () => {
  shutdownServer("SIGINT");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
