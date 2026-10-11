/**
 * logic.js – Pure helper functions.
 *
 * Nothing in this file touches the screen or the database. That keeps the
 * rules of the app (parsing input, building a session, the one-year limit…)
 * in one place, easy to read and easy to test (see tests/index.html).
 *
 * Data shapes used throughout the app:
 *
 *   Session  = { id, startedAt, finishedAt?, exercises: Exercise[] }
 *   Exercise = { name, sets: Set[] }
 *   Set      = { weight, reps, rest }   // kg, count, seconds (rest may be null)
 *
 * Timestamps (startedAt, finishedAt) are milliseconds since 1970 (Date.now()).
 */

/* ------------------------------------------------------------------ */
/* IDs                                                                 */
/* ------------------------------------------------------------------ */

/** A random unique ID for a new session. */
export function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/**
 * The moment exactly one calendar year before `now` (as a timestamp).
 * Sessions that started before this moment are deleted automatically.
 */
export function oneYearBefore(now) {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - 1);
  return d.getTime();
}

// All dates are in English, whatever language the phone is set to. The names
// are written out here (instead of asking the browser) so they look the same
// on every phone.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const short = (name) => name.slice(0, 3); // "Sunday" → "Sun", "October" → "Oct"

/** e.g. "Sun, 11 Oct 2026" (no time) */
export function formatShortDate(ms) {
  const d = new Date(ms);
  return `${short(DAYS[d.getDay()])}, ${d.getDate()} ${short(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
}

/** e.g. "Sun, 11 Oct 2026, 17:10" */
export function formatDateTime(ms) {
  return `${formatShortDate(ms)}, ${formatTime(ms)}`;
}

/** e.g. "Sunday, 11 October" */
export function formatLongDate(ms) {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** e.g. "17:10" (24-hour clock) */
export function formatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** e.g. "October 2026" – used as a heading in the Past Sessions list. */
export function formatMonth(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** e.g. "2026-10-11" (local date) – used in the export file name. */
export function isoDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** e.g. "1 h 05 min" or "48 min" */
export function formatDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/* ------------------------------------------------------------------ */
/* Parsing what the user typed                                         */
/*                                                                     */
/* Every parser returns:                                               */
/*   a number  – the input is valid                                    */
/*   null      – the field is empty                                    */
/*   NaN       – the input is not valid                                */
/* ------------------------------------------------------------------ */

/** Weight in kg. Decimals allowed with "." or "," (e.g. "22.5", "22,5"). */
export function parseWeight(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '') return null;
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

/** Reps: a whole number of at least 1. */
export function parseReps(text) {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t) || Number(t) < 1) return NaN;
  return Number(t);
}

/**
 * Rest in seconds. Accepts plain seconds ("90") or minutes and seconds
 * ("1:30"). Because the iPhone number pad has no ":" key, "1.30" and
 * "1,30" also mean 1 minute 30 seconds. Seconds must be two digits (00–59).
 */
export function parseRest(text) {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(\d+)[:.,](\d{2})$/);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return NaN;
}

/* ------------------------------------------------------------------ */
/* Formatting numbers for display                                      */
/* ------------------------------------------------------------------ */

/** 22.5 → "22.5", 20 → "20" */
export function formatWeight(kg) {
  return String(Math.round(Number(kg) * 100) / 100);
}

/** 90 → "1:30", 5 → "0:05", null → "–" */
export function formatRest(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '–';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** { weight: 22.5, reps: 8 } → "22.5 kg × 8" */
export function formatSet(set) {
  return `${formatWeight(set.weight)} kg × ${set.reps}`;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/** A new, empty session that starts at `now`. */
export function newSession(now) {
  return { id: makeId(), startedAt: now, exercises: [] };
}

/** "  bench   Press " → "bench press" – used to compare exercise names. */
export function normalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Tidies up a typed name: trims and collapses double spaces. */
export function cleanName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Adds a set to the session. If an exercise with the same name (ignoring
 * upper/lower case) already exists, the set is added to it; otherwise a new
 * exercise is created. Changes `session` in place.
 * Returns the position of the new set: { exIndex, setIndex }.
 */
export function addSet(session, name, set) {
  const key = normalizeName(name);
  let exIndex = session.exercises.findIndex((ex) => normalizeName(ex.name) === key);
  if (exIndex === -1) {
    session.exercises.push({ name: cleanName(name), sets: [] });
    exIndex = session.exercises.length - 1;
  }
  const sets = session.exercises[exIndex].sets;
  sets.push({ weight: set.weight, reps: set.reps, rest: set.rest ?? null });
  return { exIndex, setIndex: sets.length - 1 };
}

/** Replaces one set. Changes `session` in place. */
export function updateSet(session, exIndex, setIndex, set) {
  session.exercises[exIndex].sets[setIndex] = {
    weight: set.weight, reps: set.reps, rest: set.rest ?? null,
  };
}

/**
 * Removes one set. If that was the exercise's last set, the (now empty)
 * exercise is removed too. Changes `session` in place.
 */
export function removeSet(session, exIndex, setIndex) {
  const ex = session.exercises[exIndex];
  ex.sets.splice(setIndex, 1);
  if (ex.sets.length === 0) session.exercises.splice(exIndex, 1);
}

/** Removes a whole exercise with all its sets. Changes `session` in place. */
export function removeExercise(session, exIndex) {
  session.exercises.splice(exIndex, 1);
}

/** Total number of sets in a session. */
export function countSets(session) {
  return session.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
}

/** e.g. "3 exercises" */
export function exerciseCount(session) {
  const e = session.exercises.length;
  return `${e} ${e === 1 ? 'exercise' : 'exercises'}`;
}

/** e.g. "3 exercises · 12 sets" */
export function summarize(session) {
  const s = countSets(session);
  return `${exerciseCount(session)} · ${s} ${s === 1 ? 'set' : 'sets'}`;
}

/**
 * Turns the in-progress session into the record that gets saved: removes
 * empty exercises, drops the half-typed form and stamps the finish time.
 * Returns null if there is nothing worth saving (no sets at all).
 */
export function prepareForSave(draft, now) {
  const exercises = draft.exercises
    .filter((ex) => ex.sets.length > 0)
    .map((ex) => ({ name: ex.name, sets: ex.sets.map((s) => ({ ...s })) }));
  if (exercises.length === 0) return null;
  return { id: draft.id, startedAt: draft.startedAt, finishedAt: now, exercises };
}

/* ------------------------------------------------------------------ */
/* Exercise name suggestions                                           */
/* ------------------------------------------------------------------ */

/**
 * Collects every exercise used in `sessions`, with the most recent time it
 * was done and its last set (to pre-fill the form).
 * Returns [{ name, key, lastUsed, position, lastSet }], most recently used
 * first. Within one session, exercises done later count as more recent.
 */
export function buildExerciseIndex(sessions) {
  const byKey = new Map();
  for (const session of sessions) {
    session.exercises.forEach((ex, position) => {
      const key = normalizeName(ex.name);
      const known = byKey.get(key);
      if (ex.sets.length && (!known || session.startedAt > known.lastUsed)) {
        byKey.set(key, {
          name: ex.name, key, lastUsed: session.startedAt, position, lastSet: ex.sets[ex.sets.length - 1],
        });
      }
    });
  }
  return [...byKey.values()].sort((a, b) => b.lastUsed - a.lastUsed || b.position - a.position);
}

/**
 * Picks names from `names` that match what the user has typed so far.
 * Names starting with the query come first, then names containing it.
 * An exact match is left out (it's already typed). With an empty query,
 * the first `limit` names (most recent) are returned.
 */
export function suggestNames(names, query, limit = 8) {
  const q = normalizeName(query);
  if (!q) return names.slice(0, limit);
  const starts = [];
  const contains = [];
  for (const name of names) {
    const n = normalizeName(name);
    if (n === q) continue;
    if (n.startsWith(q)) starts.push(name);
    else if (n.includes(q)) contains.push(name);
  }
  return [...starts, ...contains].slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Backup files                                                        */
/* ------------------------------------------------------------------ */

/** Builds the JSON text for the "Export data" backup file. */
export function buildBackup(sessions, now) {
  return JSON.stringify({
    app: 'workout-log',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    sessions,
  }, null, 2);
}

/**
 * Reads a backup file's text and returns its sessions.
 * Throws an Error with a readable message if the file isn't a valid backup.
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!data || data.app !== 'workout-log' || !Array.isArray(data.sessions)) {
    throw new Error('This is not a Workout Log backup file.');
  }
  const valid = data.sessions.every((s) =>
    s && typeof s.id === 'string' && typeof s.startedAt === 'number' &&
    Array.isArray(s.exercises) &&
    s.exercises.every((ex) => typeof ex.name === 'string' && Array.isArray(ex.sets)));
  if (!valid) throw new Error('The backup file is damaged.');
  return data.sessions;
}
