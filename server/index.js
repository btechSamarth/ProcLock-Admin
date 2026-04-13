/**
 * server/index.js
 *
 * Initialises and starts the Express server inside the Electron main process.
 * The server binds to 0.0.0.0 so LAN devices can reach it.
 * All route logic lives in routes.js to keep this file focused on startup.
 */

const express = require('express');
const { registerRoutes } = require('./routes');

const PORT = process.env.PORT || 3000;

/**
 * Starts the Express server and registers all API routes.
 *
 * @param {string} inviteCode - The session invite code generated at startup.
 * @returns {Promise<http.Server>} Resolves with the running http.Server instance.
 */
function startServer(inviteCode) {
  return new Promise((resolve, reject) => {
    const app = express();

    // Parse incoming JSON request bodies
    app.use(express.json());

    // Mount all API routes, passing the invite code for validation
    registerRoutes(app, inviteCode);

    // Bind to 0.0.0.0 so the server is reachable from other LAN devices,
    // not just localhost.
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Express listening on 0.0.0.0:${PORT}`);
      resolve(server);
    });

    server.on('error', (err) => {
      console.error('[Server] Failed to start:', err);
      reject(err);
    });
  });
}

module.exports = { startServer, PORT };
