/**
 * server/routes.js
 *
 * Defines all API routes for the teacher server.
 * Routes are registered against the Express app instance passed in from index.js.
 *
 * Phase 1 routes:
 *   POST /join  — Student submits an invite code to join the session.
 *
 * Designed to be extended: future phases can add /submit, /results, /ping, etc.
 */

/**
 * Registers all API routes on the provided Express app.
 *
 * @param {import('express').Application} app
 * @param {string} inviteCode - The active session invite code to validate against.
 */
function registerRoutes(app, inviteCode) {
  /**
   * POST /join
   *
   * Body: { code: string }
   *
   * Students call this endpoint to verify the invite code and join the session.
   * Returns { success: true } on a match, { success: false } otherwise.
   * Always returns HTTP 200 so the client can read the JSON body cleanly.
   */
  app.post('/join', (req, res) => {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing or invalid code field.' });
    }

    // Case-insensitive comparison — students may type the code in lowercase
    const isValid = code.trim().toUpperCase() === inviteCode;

    if (isValid) {
      console.log(`[Routes] /join  — valid code accepted`);
      return res.json({ success: true });
    }

    console.log(`[Routes] /join  — invalid code rejected: "${code}"`);
    return res.json({ success: false });
  });

  // ---------------------------------------------------------------------------
  // Future routes go here, e.g.:
  //   app.post('/submit', handleSubmission);
  //   app.get('/results', getResults);
  // ---------------------------------------------------------------------------
}

module.exports = { registerRoutes };
