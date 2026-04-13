/**
 * preload.js
 *
 * Runs in a privileged Node context, injected into the renderer page.
 * Uses contextBridge to expose a minimal, explicitly-allowlisted API.
 *
 * The renderer can ONLY call methods listed in this file.
 * Nothing else from Node / Electron is reachable from renderer code.
 *
 * Exposed API — window.examAPI:
 *   getSessionInfo()   → Promise<{ ip, port, inviteCode }>
 *   saveTestFile(opts) → Promise<{ ok, filePath? } | { ok, cancelled } | { ok, error }>
 *
 * IPC pattern: invoke / handle (request-response).
 * Avoids send / on (fire-and-forget) for predictability.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('examAPI', {
  /**
   * Deletes a local exam folder and its contents.
   * @param {object} options
   * @param {string} options.examId
   * @param {string} options.userId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  
  deleteExam: (options) => ipcRenderer.invoke('delete-exam', options),
  /**
   * Marks a student submission as evaluated.
   * @param {object} options
   * @param {string} options.examId
   * @param {string} options.fileName
   * @param {object} options.evaluation
   * @param {string} options.userId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  markEvaluated: (options) => ipcRenderer.invoke('mark-evaluated', options),
  /**
   * Fetches server session info (IP, port, invite code) from the main process.
   * Called once by the StartScreen controller on first visit.
   *
   * @returns {Promise<{ ip: string, port: number, inviteCode: string }>}
   */
  getSessionInfo: () => ipcRenderer.invoke('get-session-info'),

  /**
   * Asks the main process to open a Save dialog and write the test JSON file.
   *
   * @param {{ filename: string, data: object }} opts
   *   filename — suggested filename, e.g. "DSA_Test_1.json"
   *   data     — the full test object to serialise
   *
   * @returns {Promise<
   *   { ok: true,  filePath: string } |
   *   { ok: false, cancelled: true  } |
   *   { ok: false, error: string    }
   * >}
   */
  saveTestFile: (opts) => ipcRenderer.invoke('save-test-file', opts),

  /**
   * Loads all saved tests from the userData/tests folder on disk.
   *
   * @returns {Promise<Array<{ id, title, duration, questionCount, createdAt, filePath }>>}
   */
  loadTests: () => ipcRenderer.invoke('load-tests'),

  /**
   * Deletes a test JSON file from disk.
   * @param {string} filePath
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  deleteTest: (filePath) => ipcRenderer.invoke('delete-test', filePath),

  /**
   * Broadcasts the selected test to all connected TCP clients.
   * @param {object} test  Full test object (title, questions, duration, …)
   * @returns {Promise<{ ok: boolean, clientCount: number, error?: string }>}
   */
  broadcastTest: (test) => ipcRenderer.invoke('broadcast-test', test),

  /**
   * Registers a callback invoked whenever the connected students list changes.
   * @param {function} callback  Receives Array<{ name, enroll }>
   */
  onStudentsUpdated: (callback) => ipcRenderer.on('students-updated', (_event, students) => callback(students)),

  /**
   * Returns the list of exam IDs from /records/{userId} folder (one per completed exam).
   * @param {object} options
   * @param {string} options.userId
   * @returns {Promise<Array<string>>}
   */
  getExams: (options) => ipcRenderer.invoke('get-exams', options),

  /**
   * Returns all student submissions for a given examId.
   * @param {object} options
   * @param {string} options.examId
   * @param {string} options.userId
   * @returns {Promise<Array<{ name, enroll, cheating, file }>>}
   */
  getStudents: (options) => ipcRenderer.invoke('get-students', options),

  /**
   * Returns the full submission JSON for one student.
   * @param {object} options
   * @param {string} options.examId
   * @param {string} options.fileName  e.g. "CS101.json"
   * @param {string} options.userId
   * @returns {Promise<object>}
   */
  getStudentReport: (options) => ipcRenderer.invoke('get-student-report', options),

  endExam: () => ipcRenderer.invoke('end-exam'),

  getActiveExam: () => ipcRenderer.invoke('get-active-exam'),

  saveAttachment: (args) => ipcRenderer.invoke('save-attachment', args),

  /**
   * Repairs an incomplete exam record by recreating the missing exam.json file.
   * @param {object} options
   * @param {string} options.examId
   * @param {object} options.metadata  Basic metadata to use for the exam.json
   * @param {string} options.userId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  repairExamRecord: (options) => ipcRenderer.invoke('repair-exam-record', options),

  /**
   * Cleans up an orphaned exam folder (removes the folder and its contents).
   * @param {object} options
   * @param {string} options.examId
   * @param {string} options.userId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  cleanupOrphanedExam: (options) => ipcRenderer.invoke('cleanup-orphaned-exam', options),

  /**
   * Creates a local exam record from cloud data (used by SyncManager).
   * @param {object} options
   * @param {object} options.exam
   * @param {string} options.userId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  createLocalExamRecord: (options) => ipcRenderer.invoke('create-local-exam-record', options),

  /**
   * Saves a submission locally from cloud data (used by SyncManager).
   * @param {object} options
   * @param {string} options.examId
   * @param {object} options.submission
   * @param {string} options.userId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  saveSubmissionLocally: (options) => ipcRenderer.invoke('save-submission-locally', options),

  /**
   * Opens Google OAuth flow in the system browser.
   * Spins up a local callback server in main to catch the redirect.
   *
   * @returns {Promise<{ code: string }>}
   */
  startGoogleAuth: () => ipcRenderer.invoke('auth:start-google'),

  /**
   * Exchanges a one-time OAuth code for Firebase-compatible tokens.
   *
   * @param {string} code  The authorisation code from startGoogleAuth
   * @returns {Promise<{ id_token: string, access_token: string } | { error: string }>}
   */
  exchangeAuthCode: (code) => ipcRenderer.invoke('auth:exchange-code', code),

  /**
   * Sends the teacher's Firebase uid + idToken to the main process.
   * Must be called once after a successful Firebase sign-in so that
   * main can save student submissions to Firestore via REST.
   *
   * Call this after signInWithCredential, and again whenever the token
   * is refreshed (idToken expires after 1 hour).
   *
   * @param {string} uid      Firebase user uid
   * @param {string} idToken  Fresh Firebase ID token (from user.getIdToken())
   * @returns {Promise<{ ok: true }>}
   */
  setFirebaseSession: (uid, idToken) => ipcRenderer.invoke('set-firebase-session', uid, idToken),

  /**
   * Clears the Firebase session from the main process.
   * Must be called on sign-out so the next user's login starts with a clean slate.
   * Without this, the previous user's UID stays in memory and their tests/records
   * remain accessible until set-firebase-session is called for the new user.
   *
   * @returns {Promise<{ ok: true }>}
   */
  clearFirebaseSession: () => ipcRenderer.invoke('clear-firebase-session'),

  // ===========================================================================
  // TEMP USER WORKSPACE
  // Path: userData/temp/{userId}/
  // Used ONLY during an active editing session. Must be deleted when done.
  // ===========================================================================

  /**
   * Creates (or fully overwrites) the temp workspace for this user.
   * Writes exams.json, submissions.json, reviews.json, metadata.json.
   *
   * @param {object} options
   * @param {string} options.userId
   * @param {{ exams: any[], submissions: any[], reviews: any[], metadata?: object }} options.data
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  createTempUserWorkspace: (options) => ipcRenderer.invoke('create-temp-user-workspace', options),

  /**
   * Reads all temp workspace files and returns a combined object.
   *
   * @param {object} options
   * @param {string} options.userId
   * @returns {Promise<{ ok: true, data: { exams, submissions, reviews, metadata } } | { ok: false, error: string }>}
   */
  getTempUserWorkspace: (options) => ipcRenderer.invoke('get-temp-user-workspace', options),

  /**
   * Fully overwrites only the provided keys in the temp workspace.
   * Keys absent from updatedData are left untouched.
   *
   * @param {object} options
   * @param {string} options.userId
   * @param {{ exams?: any[], submissions?: any[], reviews?: any[], metadata?: object }} options.updatedData
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  updateTempUserWorkspace: (options) => ipcRenderer.invoke('update-temp-user-workspace', options),

  /**
   * Deletes the entire temp/{userId}/ directory.
   * Must be called when the editing session ends.
   *
   * @param {object} options
   * @param {string} options.userId
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  deleteTempUserWorkspace: (options) => ipcRenderer.invoke('delete-temp-user-workspace', options),

  // ===========================================================================
  // SESSION LOCK
  // ===========================================================================

  /**
   * Checks whether a session lock exists for this user.
   * @param {{ userId: string }} options
   * @returns {Promise<{ locked: boolean, pid?: number, since?: string }>}
   */
  checkSessionLock: (options) => ipcRenderer.invoke('check-session-lock', options),

  /**
   * Acquires the session lock and starts periodic cloud sync.
   * @param {{ userId: string }} options
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  acquireSessionLock: (options) => ipcRenderer.invoke('acquire-session-lock', options),

  /**
   * Releases the session lock and stops periodic cloud sync.
   * @param {{ userId: string }} options
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  releaseSessionLock: (options) => ipcRenderer.invoke('release-session-lock', options),

  /**
   * Manually triggers a workspace sync to cloud (called before close).
   * @param {{ userId: string }} options
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  syncWorkspaceToCloud: (options) => ipcRenderer.invoke('sync-workspace-to-cloud', options),
});