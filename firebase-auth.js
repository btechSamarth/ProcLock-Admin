import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  getDocs,
  deleteDoc,
  collection,
  collectionGroup,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCTGeChRdDBk0T_mhdWeX1_xjsb2DgLNMk",
  authDomain: "proclock-exam.firebaseapp.com",
  projectId: "proclock-exam",
  storageBucket: "proclock-exam.firebasestorage.app",
  messagingSenderId: "541925626794",
  appId: "1:541925626794:web:a878c24d5d7e5aa57d91d3",
  measurementId: "G-1YKW0VQBQN"
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
// Firebase persists the session in IndexedDB automatically —
// no manual localStorage needed.

/**
 * Signs in to Firebase using Google id_token + access_token
 * obtained from the main-process OAuth code exchange.
 *
 * Called by renderer after window.examAPI.exchangeAuthCode() succeeds.
 *
 * @param {string} idToken
 * @param {string} accessToken
 * @returns {Promise<import("firebase/auth").User>}
 */
export async function signInWithGoogleToken(idToken, accessToken) {
  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  const result     = await signInWithCredential(auth, credential);
  return result.user;
}

/**
 * Registers a callback that fires whenever auth state changes.
 * Use this in the renderer boot sequence to restore a previous session
 * without requiring the user to log in again.
 *
 * @param {(user: import("firebase/auth").User | null) => void} callback
 */
export function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}

/**
 * Signs the current user out of Firebase.
 * @returns {Promise<void>}
 */
export async function signOutUser() {
  await signOut(auth);
}

/**
 * Creates a teachers/{uid} document only if it doesn't exist yet.
 * Safe to call on every login — will never overwrite existing data.
 *
 * Firestore structure:
 *   teachers/{uid}              ← this function writes here
 *   teachers/{uid}/exams/{id}   ← future: one sub-collection per exam
 *
 * @param {import("firebase/auth").User} user
 */
export async function ensureTeacherDoc(user) {
  try {
    const ref  = doc(db, 'teachers', user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, {
        name:      user.displayName,
        email:     user.email,
        createdAt: serverTimestamp(),
      });
      console.log('[Firestore] Teacher doc created:', user.uid);
    } else {
      console.log('[Firestore] Teacher doc already exists — skipping.');
    }
  } catch (err) {
    // Non-fatal — log and continue. Auth is still valid even if Firestore write fails.
    console.error('[Firestore] ensureTeacherDoc failed:', err.message);
  }
}

/**
 * Saves a single exam to Firestore at teachers/{uid}/exams/{examId}.
 * merge:true ensures existing fields are never wiped.
 *
 * @param {string} uid
 * @param {string} examId
 * @param {object} examData
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function saveExamToCloud(uid, examId, examData) {
  try {
    const ref = doc(db, 'teachers', uid, 'exams', examId);
    await setDoc(ref, { ...examData, savedAt: serverTimestamp() }, { merge: true });
    console.log('[Firestore] Exam saved to cloud:', examId);
    return { ok: true };
  } catch (err) {
    console.error('[Firestore] saveExamToCloud failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Fetches all exams from Firestore at teachers/{uid}/exams.
 * Returns an array shaped to match state.tests entries.
 *
 * @param {string} uid
 * @returns {Promise<Array<object>>}
 */
export async function fetchExamsFromCloud(uid) {
  try {
    const snap = await getDocs(collection(db, 'teachers', uid, 'exams'));
    if (snap.empty) return [];
    return snap.docs.map(d => ({
      ...d.data(),
      id:       d.data().testId ?? d.id,
      testId:   d.data().testId ?? d.id,
      filePath: d.data().filePath ?? null,
    }));
  } catch (err) {
    console.error('[Firestore] fetchExamsFromCloud failed:', err.message);
    return [];
  }
}

/**
 * Syncs local exams with Firestore:
 *   1. Fetches all cloud exams
 *   2. Merges with local — cloud is source of truth for duplicates
 *   3. Auto-uploads local exams missing from cloud
 *
 * Returns the merged array ready to set as state.tests.
 *
 * @param {string}        uid
 * @param {Array<object>} localExams  — current state.tests (already loaded from disk)
 * @returns {Promise<Array<object>>}
 */
export async function syncExams(uid, localExams) {
  try {
    const cloudExams   = await fetchExamsFromCloud(uid);
    const cloudIds     = new Set(cloudExams.map(e => e.testId));
    const localIds     = new Set(localExams.map(e => e.testId));

    // ── Upload local exams that don't exist in cloud ──
    const missingInCloud = localExams.filter(e => e.testId && !cloudIds.has(e.testId));
    if (missingInCloud.length > 0) {
      console.log(`[Sync] Uploading ${missingInCloud.length} local exam(s) to cloud…`);
      await Promise.all(
        missingInCloud.map(e => saveExamToCloud(uid, e.testId, e))
      );
    }

    // ── Merge: start with cloud (source of truth), append local-only entries ──
    const localOnly = localExams.filter(e => !cloudIds.has(e.testId));
    const merged    = [...cloudExams, ...localOnly];

    console.log(`[Sync] Done — ${merged.length} exam(s) total (${cloudExams.length} cloud, ${localOnly.length} local-only).`);
    return merged;
  } catch (err) {
    console.error('[Sync] syncExams failed:', err.message);
    throw err;
  }
}

/**
 * Deletes an exam document from Firestore at teachers/{uid}/exams/{examId}.
 *
 * @param {string} uid
 * @param {string} examId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function deleteExamFromCloud(uid, examId) {
  try {
    await deleteDoc(doc(db, 'teachers', uid, 'exams', examId));
    console.log('[Firestore] Exam deleted from cloud:', examId);
    return { ok: true };
  } catch (err) {
    console.error('[Firestore] deleteExamFromCloud failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Deletes an exam session document from Firestore at teachers/{uid}/examSessions/{examId}.
 * Also deletes all associated submissions from teachers/{uid}/exams/{examId}/submissions.
 *
 * @param {string} uid
 * @param {string} examId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function deleteExamSessionFromCloud(uid, examId) {
  console.log(`[Firestore] deleteExamSessionFromCloud called for uid: ${uid}, examId: ${examId}`);
  try {
    console.log(`[Firestore] Checking for submissions in exams path: teachers/${uid}/exams/${examId}/submissions`);
    const submissionsRef = collection(db, 'teachers', uid, 'exams', examId, 'submissions');
    const submissionsSnap = await getDocs(submissionsRef);
    console.log(`[Firestore] Found ${submissionsSnap.docs.length} submissions in exams path`);
    const deletePromises = submissionsSnap.docs.map(doc => {
      console.log(`[Firestore] Deleting submission: ${doc.id}`);
      return deleteDoc(doc.ref);
    });

    console.log(`[Firestore] Deleting ${deletePromises.length} total submissions`);
    await Promise.all(deletePromises);
    console.log(`[Firestore] All submissions deleted successfully`);

    // Cleanup any exam metadata document too
    console.log(`[Firestore] Deleting exam metadata doc: teachers/${uid}/exams/${examId}`);
    await deleteDoc(doc(db, 'teachers', uid, 'exams', examId));
    console.log(`[Firestore] Exam metadata document deleted successfully (if existed)`);

    // Finally, delete the exam session document itself
    console.log(`[Firestore] Deleting exam session document: teachers/${uid}/examSessions/${examId}`);
    await deleteDoc(doc(db, 'teachers', uid, 'examSessions', examId));
    console.log(`[Firestore] Exam session document deleted successfully`);

    console.log('[Firestore] Exam session and all submissions deleted from cloud:', examId);
    return { ok: true };
  } catch (err) {
    console.error('[Firestore] deleteExamSessionFromCloud failed:', err.message);
    return { ok: false, error: err.message };
  }
}


/**
 * Saves an exam session record to Firestore at:
 *   teachers/{uid}/examSessions/{examId}
 *
 * Called from main process via IPC after broadcast-test succeeds.
 * Lets the review screen list past sessions across machines.
 *
 * @param {string} uid
 * @param {string} examId
 * @param {{ title, teacherName, date }} meta
 */
export async function saveExamSession(uid, examId, meta) {
  try {
    const ref = doc(db, 'teachers', uid, 'examSessions', examId);
    await setDoc(ref, { examId, ...meta, createdAt: serverTimestamp() }, { merge: true });
    console.log('[Firestore] Exam session saved:', examId);
    return { ok: true };
  } catch (err) {
    console.error('[Firestore] saveExamSession failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Fetches all exam session records from Firestore at:
 *   teachers/{uid}/examSessions
 *
 * Returns array of { examId, title, teacherName, date }.
 *
 * @param {string} uid
 * @returns {Promise<Array<{ examId, title, teacherName, date }>>}
 */
export async function fetchExamSessionsFromCloud(uid) {
  console.log(`[Firestore] fetchExamSessionsFromCloud called for uid: ${uid}`);
  try {
    // Primary path: selectors stored as examSessions metadata documents.
    const sessionsSnap = await getDocs(collection(db, 'teachers', uid, 'examSessions'));
    console.log(`[Firestore] Found ${sessionsSnap.docs.length} exam sessions in teachers/${uid}/examSessions`);
    if (!sessionsSnap.empty) {
      const sessions = sessionsSnap.docs.map(d => ({
        examId:      d.id,
        title:       d.data().title       ?? d.id,
        teacherName: d.data().teacherName ?? '—',
        date:        d.data().date        ?? '',
      }));
      console.log('[Firestore] Cloud exam sessions:', sessions.map(s => ({ id: s.examId, title: s.title })));
      return sessions;
    }

    // Fallback 1: exam metadata may have been written under teachers/{uid}/exams
    const examsMetaSnap = await getDocs(collection(db, 'teachers', uid, 'exams'));
    console.log(`[Firestore] Found ${examsMetaSnap.docs.length} exam metadata docs in teachers/${uid}/exams`);
    if (!examsMetaSnap.empty) {
      const exams = examsMetaSnap.docs.map(d => ({
        examId:      d.id,
        title:       d.data().title       ?? d.id,
        teacherName: d.data().teacherName ?? '—',
        date:        d.data().date        ?? '',
      }));
      console.log('[Firestore] Cloud exam metadata fallback:', exams.map(s => ({ id: s.examId, title: s.title })));
      return exams;
    }

    // Fallback 2: infer exam IDs from submissions stored under teachers/{uid}/exams/{examId}/submissions.
    console.log('[Firestore] Falling back to collectionGroup query on submissions');
    const submissionsSnap = await getDocs(collectionGroup(db, 'submissions'));
    console.log(`[Firestore] Found ${submissionsSnap.docs.length} submission docs in collectionGroup 'submissions'`);
    const examsById = new Map();

    for (const docSnap of submissionsSnap.docs) {
      const ref = docSnap.ref;
      const parent = ref.parent; // submissions collection
      const examDoc = parent.parent; // parent document of submissions collection
      const examsCollection = examDoc?.parent;
      if (!examDoc || !examsCollection || examsCollection.id !== 'exams') continue;

      const examId = examDoc.id;
      if (!examId) continue;

      if (examsById.has(examId)) continue;

      const data = docSnap.data();
      const title = data.title || data.examId || examId;
      const teacherName = data.teacherName || '—';
      const date = data.date || '';

      // Keep every unique examId found in submissions; this is a fallback only.
      examsById.set(examId, { examId, title, teacherName, date });
    }

    const inferred = Array.from(examsById.values());
    console.log('[Firestore] Inferred cloud exams from submissions:', inferred.map(s => ({ id: s.examId, title: s.title })));
    return inferred;
  } catch (err) {
    console.error('[Firestore] fetchExamSessionsFromCloud failed:', err.message);
    throw err;
  }
}

/**
 * Fetches all student submissions for one exam from Firestore at:
 *   teachers/{uid}/exams/{examId}/submissions
 *
 * Returns array shaped to match local student file entries.
 *
 * @param {string} uid
 * @param {string} examId
 * @returns {Promise<Array<{ name, enroll, cheating, evaluated, file, _fromCloud }>>}
 */
export async function fetchSubmissionsFromCloud(uid, examId) {
  try {
    const snap = await getDocs(
      collection(db, 'teachers', uid, 'exams', examId, 'submissions')
    );
    if (snap.empty) return [];
    return snap.docs.map(d => {
      const data = d.data();
      const submissionId = data.submissionId ?? d.id;
      const studentName = data.studentName ?? data.student?.name ?? data.name ?? d.id;
      const enroll = data.enroll ?? data.student?.enroll ?? data.studentId ?? d.id;
      const answers = data.answers ?? data.submissions ?? {};
      const cheating = data.cheating ?? data.tampered ?? false;
      const score = typeof data.score === 'number'
        ? data.score
        : typeof data.marks === 'number'
          ? data.marks
          : null;

      return {
        // Normalized fields
        submissionId,
        studentName,
        enroll,
        answers,
        cheating,
        score,

        // Backward-compatible fields for existing callers
        name:       studentName,
        evaluated:  data.evaluated ?? false,
        file:       `${enroll}.json`, // virtual filename for compatibility
        _fromCloud: true,
        _data:      data,
      };
    });
  } catch (err) {
    console.error('[Firestore] fetchSubmissionsFromCloud failed:', err.message);
    throw err;
  }
}

/**
 * Fetches a single submission document from Firestore at:
 *   teachers/{uid}/exams/{examId}/submissions/{enroll}
 *
 * Returns the raw submission object shaped like a local .json file.
 *
 * @param {string} uid
 * @param {string} examId
 * @param {string} enroll
 * @returns {Promise<object|null>}
 */
export async function fetchSubmissionDetailFromCloud(uid, examId, enroll) {
  try {
    const ref  = doc(db, 'teachers', uid, 'exams', examId, 'submissions', enroll);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data();
    // Re-shape to match local submission JSON structure
    return {
      student:     { name: d.studentName ?? enroll, enroll: d.enroll ?? enroll },
      submissions: d.answers ?? {},
      cheating:    d.cheating  ?? false,
      evaluated:   d.evaluated ?? false,
      evaluation:  d.evaluation ?? null,
      submittedAt: d.submittedAt ?? null,
      _fromCloud:  true,
    };
  } catch (err) {
    console.error('[Firestore] fetchSubmissionDetailFromCloud failed:', err.message);
    throw err;
  }
}

// /**
//  * Fetches a complete snapshot of the teacher's data from Firestore in one pass.
//  * Returns a unified object used to populate the temp workspace on login.
//  *
//  * Collections fetched:
//  *   teachers/{uid}/exams                   -> exams[]
//  *   teachers/{uid}/exams/*/submissions     -> submissions[] (collectionGroup, filtered to uid path)
//  *   teachers/{uid}/examSessions            -> reviews[]
//  *
//  * Every item includes id: doc.id.
//  *
//  * @param {string} uid
//  * @returns {Promise<{ exams: Array<object>, submissions: Array<object>, reviews: Array<object> }>}
//  **/
export async function fetchFullUserData(uid) {
  console.log('[Snapshot] fetchFullUserData called for uid:', uid);

  // ── 1. Fetch exams ──────────────────────────────────────────────────────────
  let exams = [];
  try {
    const examsSnap = await getDocs(collection(db, 'teachers', uid, 'exams'));
    exams = examsSnap.docs.map(d => ({
      ...d.data(),
      id:     d.id,
      testId: d.data().testId ?? d.id,
    }));
    console.log(`[Snapshot] Fetched ${exams.length} exam(s)`);
  } catch (err) {
    console.error('[Snapshot] Failed to fetch exams:', err.message);
  }

  // ── 2. Fetch submissions (collectionGroup, filter to this uid's path) ───────
  let submissions = [];
  try {
    const subsSnap = await getDocs(collectionGroup(db, 'submissions'));
    submissions = subsSnap.docs
      .filter(d => {
        // Path shape: teachers/{uid}/exams/{examId}/submissions/{subId}
        // d.ref.path starts with "teachers/{uid}/"
        return d.ref.path.startsWith(`teachers/${uid}/`);
      })
      .map(d => {
        const data = d.data();
        const submissionId = data.submissionId ?? d.id;
        // Derive examId from the path segment
        const pathParts = d.ref.path.split('/'); // [teachers, uid, exams, examId, submissions, subId]
        const examId = pathParts[3] ?? null;
        return {
          ...data,
          id:           d.id,
          submissionId,
          examId,
          studentName:  data.studentName ?? data.student?.name ?? data.name ?? d.id,
          enroll:       data.enroll ?? data.student?.enroll ?? data.studentId ?? d.id,
          answers:      data.answers ?? data.submissions ?? {},
          cheating:     data.cheating ?? data.tampered ?? false,
          evaluated:    data.evaluated ?? false,
          score: typeof data.score === 'number'
            ? data.score
            : typeof data.marks === 'number' ? data.marks : null,
          _fromCloud:   true,
        };
      });
    console.log(`[Snapshot] Fetched ${submissions.length} submission(s) for uid ${uid}`);
  } catch (err) {
    console.error('[Snapshot] Failed to fetch submissions:', err.message);
  }

  // ── 3. Fetch examSessions ────────────────────────────────────────────────────
  let reviews = [];
  try {
    const sessionsSnap = await getDocs(collection(db, 'teachers', uid, 'examSessions'));
    reviews = sessionsSnap.docs.map(d => ({
      ...d.data(),
      id:          d.id,
      examId:      d.id,
      title:       d.data().title       ?? d.id,
      teacherName: d.data().teacherName ?? '—',
      date:        d.data().date        ?? '',
    }));
    console.log(`[Snapshot] Fetched ${reviews.length} exam session(s)`);
  } catch (err) {
    console.error('[Snapshot] Failed to fetch examSessions:', err.message);
  }

  return { exams, submissions, reviews };
}

/** Exposes the auth instance for advanced use (e.g. currentUser checks). */
export function getAuthInstance() {
  return auth;
}