/**
 * db.js – Saving and loading data on the phone with IndexedDB.
 *
 * IndexedDB is a database built into every browser. Everything stays on the
 * device: no account, no server. The database has two "object stores"
 * (think: tables):
 *
 *   sessions – finished workout sessions, looked up by id and sorted by
 *              their start time (the "startedAt" index)
 *   draft    – at most one entry: the session in progress, saved after every
 *              change so nothing is lost if the app is closed mid-workout
 *
 * IndexedDB's own API is callback based; the small helpers below wrap it in
 * Promises so the rest of the app can simply `await` each call.
 */

import { oneYearBefore } from './logic.js';

const DB_VERSION = 1;
const SESSIONS = 'sessions';
const DRAFT = 'draft';
const DRAFT_KEY = 'current';

/** Turns an IndexedDB request into a Promise of its result. */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves once a transaction has been fully written to disk. */
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Database transaction aborted'));
  });
}

/**
 * Opens (and on first use, creates) the database.
 * `name` can be changed so the tests use their own, separate database.
 */
export function openDatabase(name = 'workout-log') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);

    // Runs only when the database is created (or DB_VERSION is raised).
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        const sessions = db.createObjectStore(SESSIONS, { keyPath: 'id' });
        sessions.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains(DRAFT)) {
        db.createObjectStore(DRAFT);
      }
    };

    request.onsuccess = () => resolve(new Store(request.result));
    request.onerror = () => reject(request.error);
  });
}

/** Permanently deletes a whole database (used by the tests to clean up). */
export function deleteDatabase(name) {
  return promisify(indexedDB.deleteDatabase(name));
}

/**
 * Deletes every session that started more than one year before `now`.
 * The app calls this every time it opens. Returns how many were deleted.
 */
export function cleanupOldSessions(store, now) {
  return store.deleteSessionsBefore(oneYearBefore(now));
}

/** All database operations the app needs. */
class Store {
  constructor(db) {
    this.db = db;
  }

  /* ---------- internal helpers ---------- */

  /** Runs `work(tx)` in a read-write transaction and waits until it's saved. */
  async write(storeNames, work) {
    const tx = this.db.transaction(storeNames, 'readwrite');
    work(tx);
    await transactionDone(tx);
  }

  /** Runs a single read request against one store. */
  read(storeName, makeRequest) {
    const tx = this.db.transaction(storeName, 'readonly');
    return promisify(makeRequest(tx.objectStore(storeName)));
  }

  /* ---------- finished sessions ---------- */

  /** Saves a session (adds it, or replaces one with the same id). */
  saveSession(session) {
    return this.write([SESSIONS], (tx) => tx.objectStore(SESSIONS).put(session));
  }

  /** Saves many sessions in one go (used when importing a backup). */
  saveSessions(sessions) {
    return this.write([SESSIONS], (tx) => {
      const store = tx.objectStore(SESSIONS);
      for (const s of sessions) store.put(s);
    });
  }

  /** Loads one session, or undefined if it doesn't exist. */
  getSession(id) {
    return this.read(SESSIONS, (store) => store.get(id));
  }

  /** Loads all sessions that started at or after `sinceMs`, newest first. */
  async listSessions(sinceMs = -Infinity) {
    const range = IDBKeyRange.lowerBound(sinceMs);
    const oldestFirst = await this.read(SESSIONS, (store) => store.index('startedAt').getAll(range));
    return oldestFirst.reverse();
  }

  /** Permanently deletes one session. */
  deleteSession(id) {
    return this.write([SESSIONS], (tx) => tx.objectStore(SESSIONS).delete(id));
  }

  /** Permanently deletes all sessions that started before `cutoffMs`. Returns the count. */
  async deleteSessionsBefore(cutoffMs) {
    let count = 0;
    await this.write([SESSIONS], (tx) => {
      const range = IDBKeyRange.upperBound(cutoffMs, true); // true = "strictly before"
      const request = tx.objectStore(SESSIONS).index('startedAt').openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        count++;
        cursor.continue();
      };
    });
    return count;
  }

  /* ---------- the session in progress ---------- */

  /** Loads the in-progress session, or null if there is none. */
  async loadDraft() {
    return (await this.read(DRAFT, (store) => store.get(DRAFT_KEY))) ?? null;
  }

  /** Saves the in-progress session (called after every change). */
  saveDraft(draft) {
    return this.write([DRAFT], (tx) => tx.objectStore(DRAFT).put(draft, DRAFT_KEY));
  }

  /** Throws away the in-progress session. */
  clearDraft() {
    return this.write([DRAFT], (tx) => tx.objectStore(DRAFT).delete(DRAFT_KEY));
  }

  /**
   * Saves a finished session AND removes the draft in one transaction:
   * either both happen or neither does, so a session can't be lost or
   * saved twice.
   */
  finishSession(session) {
    return this.write([SESSIONS, DRAFT], (tx) => {
      tx.objectStore(SESSIONS).put(session);
      tx.objectStore(DRAFT).delete(DRAFT_KEY);
    });
  }

  close() {
    this.db.close();
  }
}
