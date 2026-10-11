/**
 * tests.js – Tests for the core logic: saving, loading, deleting and the
 * one-year cleanup. Open tests/index.html in a browser to run them.
 *
 * Each test gets a fresh, separate database that is deleted afterwards.
 */

import * as L from '../js/logic.js';
import { openDatabase, deleteDatabase, cleanupOldSessions } from '../js/db.js';

/* ---------- A tiny test runner ---------- */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assertEqual(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
}

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

/** Runs `fn(store)` with a brand-new test database, then deletes it. */
async function withStore(fn) {
  const name = `workout-log-test-${L.makeId()}`;
  const store = await openDatabase(name);
  try {
    await fn(store);
  } finally {
    store.close();
    await deleteDatabase(name);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 11, 12, 0).getTime(); // 11 Oct 2026, 12:00

/** A small saved session for tests. */
function sampleSession(startedAt, name = 'Bench Press') {
  const s = L.newSession(startedAt);
  L.addSet(s, name, { weight: 60, reps: 8, rest: 90 });
  return L.prepareForSave(s, startedAt + 3600000);
}

/* ================================================================== */
/* Pure logic                                                          */
/* ================================================================== */

test('parseWeight accepts decimals with "." and ","', () => {
  assertEqual(L.parseWeight('22.5'), 22.5);
  assertEqual(L.parseWeight('22,5'), 22.5);
  assertEqual(L.parseWeight(' 100 '), 100);
  assertEqual(L.parseWeight('0'), 0);
  assertEqual(L.parseWeight(''), null);
  assert(Number.isNaN(L.parseWeight('abc')), 'letters are invalid');
  assert(Number.isNaN(L.parseWeight('-5')), 'negative is invalid');
  assert(Number.isNaN(L.parseWeight('2.5.5')), 'two dots are invalid');
});

test('bodyweight sets: "BW" instead of a weight', () => {
  assertEqual(L.parseWeight('BW'), 'BW');
  assertEqual(L.parseWeight('bw'), 'BW');
  assert(Number.isNaN(L.parseWeight('BW5')), 'BW with a number is invalid');
  assertEqual(L.formatWeight('BW'), 'BW');
  assertEqual(L.formatSet({ weight: 'BW', reps: 10 }), 'BW × 10');

  const s = L.newSession(NOW);
  L.addSet(s, 'Pull-ups', { weight: L.parseWeight('BW'), reps: 10, rest: 90 });
  const saved = L.prepareForSave(s, NOW + 1000);
  assertEqual(saved.exercises[0].sets[0], { weight: 'BW', reps: 10, rest: 90 }, 'saved as BW');
  assertEqual(L.parseBackup(L.buildBackup([saved], NOW))[0].exercises[0].sets[0].weight, 'BW', 'survives export/import');
});

test('parseReps accepts whole numbers of at least 1', () => {
  assertEqual(L.parseReps('8'), 8);
  assertEqual(L.parseReps(''), null);
  assert(Number.isNaN(L.parseReps('0')), '0 reps is invalid');
  assert(Number.isNaN(L.parseReps('8.5')), 'decimals are invalid');
});

test('parseRest accepts seconds and mm:ss (also mm.ss / mm,ss)', () => {
  assertEqual(L.parseRest('90'), 90);
  assertEqual(L.parseRest('1:30'), 90);
  assertEqual(L.parseRest('1.30'), 90);
  assertEqual(L.parseRest('1,30'), 90);
  assertEqual(L.parseRest('3:00'), 180);
  assertEqual(L.parseRest('0'), 0);
  assertEqual(L.parseRest(''), null);
  assert(Number.isNaN(L.parseRest('1:75')), 'seconds over 59 are invalid');
  assert(Number.isNaN(L.parseRest('1.5')), 'one-digit seconds are ambiguous');
  assert(Number.isNaN(L.parseRest('abc')), 'letters are invalid');
});

test('parseTarget reads rep ranges, also typed on the number pad', () => {
  assertEqual(L.parseTarget('8-12'), { min: 8, max: 12 });
  assertEqual(L.parseTarget('8–12'), { min: 8, max: 12 });
  assertEqual(L.parseTarget('8.12'), { min: 8, max: 12 });
  assertEqual(L.parseTarget('8,12'), { min: 8, max: 12 });
  assertEqual(L.parseTarget(' 8 12 '), { min: 8, max: 12 });
  assertEqual(L.parseTarget('5'), { min: 5, max: 5 });
  assertEqual(L.parseTarget(''), null);
  assert(Number.isNaN(L.parseTarget('12-8')), 'max below min is invalid');
  assert(Number.isNaN(L.parseTarget('0')), '0 reps is invalid');
  assert(Number.isNaN(L.parseTarget('abc')), 'letters are invalid');
  assertEqual(L.formatTarget({ min: 8, max: 12 }), '8–12');
  assertEqual(L.formatTarget({ min: 5, max: 5 }), '5');
  assertEqual(L.formatTarget(null), '');
});

test('formatting weight, rest and sets', () => {
  assertEqual(L.formatWeight(22.5), '22.5');
  assertEqual(L.formatWeight(20), '20');
  assertEqual(L.formatRest(90), '1:30');
  assertEqual(L.formatRest(5), '0:05');
  assertEqual(L.formatRest(null), '–');
  assertEqual(L.formatSet({ weight: 22.5, reps: 8 }), '22.5 kg × 8');
  assertEqual(L.formatRest(L.parseRest('2:15')), '2:15', 'round trip');
});

test('dates are always in English', () => {
  const morning = new Date(2027, 0, 4, 9, 5).getTime(); // Monday 4 January 2027, 09:05
  assertEqual(L.formatShortDate(NOW), 'Sun, 11 Oct 2026');                       // a Sunday
  assertEqual(L.formatShortDate(morning), 'Mon, 4 Jan 2027');
  assertEqual(L.formatDateTime(NOW), 'Sun, 11 Oct 2026, 12:00');
  assertEqual(L.formatDateTime(morning), 'Mon, 4 Jan 2027, 09:05');
  assertEqual(L.formatLongDate(NOW), 'Sunday, 11 October');
  assertEqual(L.formatMonth(NOW), 'October 2026');
  assertEqual(L.formatTime(new Date(2026, 9, 11, 17, 10).getTime()), '17:10');
});

test('oneYearBefore goes back exactly one calendar year', () => {
  assertEqual(L.oneYearBefore(NOW), new Date(2025, 9, 11, 12, 0).getTime());
  // 29 Feb 2028 has no twin in 2027 – JavaScript rolls over to 1 March.
  assertEqual(L.oneYearBefore(new Date(2028, 1, 29).getTime()), new Date(2027, 2, 1).getTime());
});

test('addSet groups sets by exercise name (ignoring case and spaces)', () => {
  const s = L.newSession(NOW);
  assertEqual(L.addSet(s, 'Bench Press', { weight: 60, reps: 8, rest: 90 }), { exIndex: 0, setIndex: 0 });
  assertEqual(L.addSet(s, '  bench  press ', { weight: 62.5, reps: 6, rest: null }), { exIndex: 0, setIndex: 1 });
  assertEqual(L.addSet(s, 'Squat', { weight: 100, reps: 5 }), { exIndex: 1, setIndex: 0 });
  assertEqual(s.exercises.map((e) => e.name), ['Bench Press', 'Squat']);
  assertEqual(s.exercises[0].sets[1], { weight: 62.5, reps: 6, rest: null });
  assertEqual(L.countSets(s), 3);
  assertEqual(L.summarize(s), '2 exercises · 3 sets');
  assertEqual(L.exerciseCount(s), '2 exercises');
  L.removeExercise(s, 1);
  assertEqual(L.exerciseCount(s), '1 exercise');
});

test('editing and removing sets and exercises', () => {
  const s = L.newSession(NOW);
  L.addSet(s, 'Row', { weight: 50, reps: 10, rest: 60 });
  L.addSet(s, 'Row', { weight: 50, reps: 10, rest: 60 });
  L.addSet(s, 'Curl', { weight: 12, reps: 12, rest: 45 });

  L.updateSet(s, 0, 1, { weight: 55, reps: 8, rest: 75 });
  assertEqual(s.exercises[0].sets[1], { weight: 55, reps: 8, rest: 75 });

  L.removeSet(s, 0, 0);
  assertEqual(s.exercises[0].sets.length, 1);

  L.removeSet(s, 0, 0); // last set of "Row" → the exercise goes too
  assertEqual(s.exercises.map((e) => e.name), ['Curl']);

  L.removeExercise(s, 0);
  assertEqual(s.exercises, []);
});

test('target rep range and note are saved on the exercise', () => {
  const s = L.newSession(NOW);
  const set = { weight: 60, reps: 8, rest: 90 };
  L.addSet(s, 'Bench Press', set, { target: { min: 8, max: 12 }, note: '  Felt heavy ' });
  assertEqual(s.exercises[0].target, { min: 8, max: 12 });
  assertEqual(s.exercises[0].note, 'Felt heavy');

  L.addSet(s, 'Bench Press', set, { target: null, note: '' });
  assertEqual(s.exercises[0].note, 'Felt heavy', 'an empty note field keeps the note');
  assertEqual(s.exercises[0].target, { min: 8, max: 12 }, 'an empty target field keeps the target');

  L.addSet(s, 'Bench Press', set, { note: 'Left shoulder' });
  assertEqual(s.exercises[0].note, 'Left shoulder', 'a new note replaces the old one');

  L.updateExercise(s, 0, { name: ' Incline  Bench ', target: { min: 6, max: 6 }, note: '' });
  assertEqual(s.exercises[0].name, 'Incline Bench');
  assertEqual(s.exercises[0].target, { min: 6, max: 6 });
  assertEqual(s.exercises[0].note, undefined, 'clearing the note in Edit removes it');
  L.updateExercise(s, 0, { name: 'Incline Bench', target: null, note: '' });
  assertEqual(s.exercises[0].target, undefined, 'clearing the target in Edit removes it');
});

test('during a workout the exercise worked on last is shown first', () => {
  const s = L.newSession(NOW);
  const set = { weight: 50, reps: 10, rest: 60 };
  L.addSet(s, 'Squat', set);
  L.addSet(s, 'Bench Press', set);
  L.addSet(s, 'Row', set);
  const order = () => L.exercisesNewestFirst(s).map(({ ex }) => ex.name);
  assertEqual(order(), ['Row', 'Bench Press', 'Squat'], 'newest exercise on top');

  L.addSet(s, 'Squat', set);
  assertEqual(order(), ['Squat', 'Row', 'Bench Press'], 'an older exercise jumps back to the top');
  assertEqual(L.exercisesNewestFirst(s)[0].exIndex, 0, 'exIndex still points at the real exercise');
  assertEqual(s.exercises.map((e) => e.name), ['Squat', 'Bench Press', 'Row'], 'stored order = order started');
});

test('prepareForSave drops empty exercises and the half-typed form', () => {
  const draft = L.newSession(NOW);
  assertEqual(L.prepareForSave(draft, NOW), null, 'nothing to save');

  L.addSet(draft, 'Squat', { weight: 100, reps: 5, rest: 120 });
  draft.exercises.push({ name: 'Empty', sets: [] });
  draft.form = { name: 'Squat', weight: '100', reps: '5', rest: '2:00' };

  const saved = L.prepareForSave(draft, NOW + 1000);
  assertEqual(saved, {
    id: draft.id, startedAt: NOW, finishedAt: NOW + 1000,
    exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5, rest: 120 }] }],
  });
});

test('saved sessions keep target, note and the order exercises were done in', () => {
  const draft = L.newSession(NOW);
  const set = { weight: 50, reps: 10, rest: 60 };
  L.addSet(draft, 'Squat', set, { target: { min: 5, max: 5 } });
  L.addSet(draft, 'Bench Press', set, { target: { min: 8, max: 12 }, note: 'Felt heavy' });
  L.addSet(draft, 'Squat', set); // Squat jumped to the top during the workout…

  const saved = L.prepareForSave(draft, NOW + 1000);
  assertEqual(saved.exercises.map((e) => e.name), ['Squat', 'Bench Press'], '…but is saved first, as done first');
  assertEqual(saved.exercises[0].target, { min: 5, max: 5 });
  assertEqual(saved.exercises[1], {
    name: 'Bench Press', target: { min: 8, max: 12 }, note: 'Felt heavy', sets: [set],
  }, 'no internal "lastActive" field is saved');

  const index = L.buildExerciseIndex([saved]);
  assertEqual(index.find((e) => e.name === 'Bench Press').target, { min: 8, max: 12 }, 'target is suggested next time');
});

test('exercise suggestions: most recent first, prefix matches first', () => {
  const older = sampleSession(NOW - 10 * DAY, 'Bench Press');
  L.addSet(older, 'Curl', { weight: 12, reps: 10, rest: 60 });
  const newer = sampleSession(NOW - 1 * DAY, 'Squat');
  L.addSet(newer, 'Bench Press', { weight: 70, reps: 5, rest: 120 });

  const index = L.buildExerciseIndex([older, newer]);
  // Newest session first; inside it, the exercise done last comes first.
  assertEqual(index.map((e) => e.name), ['Bench Press', 'Squat', 'Curl']);
  assertEqual(index[0].lastSet, { weight: 70, reps: 5, rest: 120 }, 'last set comes from newest session');
  assertEqual(L.buildExerciseIndex([newer]).map((e) => e.name), ['Bench Press', 'Squat'], 'order within a session');

  const names = ['Squat', 'Bench Press', 'Incline Bench', 'Front Squat'];
  assertEqual(L.suggestNames(names, ''), names);
  assertEqual(L.suggestNames(names, 'sq'), ['Squat', 'Front Squat']);
  assertEqual(L.suggestNames(names, 'bench'), ['Bench Press', 'Incline Bench']);
  assertEqual(L.suggestNames(names, 'squat'), ['Front Squat'], 'exact match is left out');
});

test('backup: export then import gives the same sessions', () => {
  const sessions = [sampleSession(NOW), sampleSession(NOW - DAY, 'Squat')];
  const json = L.buildBackup(sessions, NOW);
  assertEqual(L.parseBackup(json), sessions);

  let message = '';
  try { L.parseBackup('{"hello": 1}'); } catch (err) { message = err.message; }
  assert(message.includes('not a Workout Log backup'), 'rejects other JSON files');
});

/* ================================================================== */
/* Database: saving, loading, deleting                                 */
/* ================================================================== */

test('save and load a session', () => withStore(async (store) => {
  const session = sampleSession(NOW);
  await store.saveSession(session);
  assertEqual(await store.getSession(session.id), session);
  assertEqual(await store.getSession('does-not-exist'), undefined);
}));

test('list sessions newest first, optionally since a date', () => withStore(async (store) => {
  const a = sampleSession(NOW - 30 * DAY);
  const b = sampleSession(NOW - 1 * DAY);
  const c = sampleSession(NOW - 10 * DAY);
  for (const s of [a, b, c]) await store.saveSession(s);

  assertEqual((await store.listSessions()).map((s) => s.id), [b.id, c.id, a.id]);
  assertEqual((await store.listSessions(NOW - 15 * DAY)).map((s) => s.id), [b.id, c.id]);
}));

test('delete a session', () => withStore(async (store) => {
  const keep = sampleSession(NOW - DAY);
  const remove = sampleSession(NOW);
  await store.saveSessions([keep, remove]);
  await store.deleteSession(remove.id);
  assertEqual((await store.listSessions()).map((s) => s.id), [keep.id]);
}));

test('draft (session in progress) is saved, loaded and cleared', () => withStore(async (store) => {
  assertEqual(await store.loadDraft(), null, 'no draft at first');

  const draft = L.newSession(NOW);
  L.addSet(draft, 'Deadlift', { weight: 140, reps: 3, rest: 180 });
  draft.form = { name: 'Deadlift', weight: '140', reps: '3', rest: '' };
  await store.saveDraft(draft);
  assertEqual(await store.loadDraft(), draft, 'survives an app restart');

  await store.clearDraft();
  assertEqual(await store.loadDraft(), null);
}));

test('finishing saves the session and removes the draft together', () => withStore(async (store) => {
  const draft = L.newSession(NOW);
  L.addSet(draft, 'Press', { weight: 40, reps: 8, rest: 90 });
  await store.saveDraft(draft);

  const session = L.prepareForSave(draft, NOW + 1000);
  await store.finishSession(session);

  assertEqual(await store.loadDraft(), null, 'draft is gone');
  assertEqual(await store.getSession(draft.id), session, 'session is saved');
}));

/* ================================================================== */
/* One-year cleanup                                                    */
/* ================================================================== */

test('cleanup deletes only sessions older than one year', () => withStore(async (store) => {
  const cutoff = L.oneYearBefore(NOW);
  const recent = sampleSession(NOW - 5 * DAY);
  const almostAYear = sampleSession(cutoff + 60000);   // 1 minute inside the year
  const exactlyAYear = sampleSession(cutoff);          // exactly one year: kept
  const justOver = sampleSession(cutoff - 60000);      // 1 minute too old
  const ancient = sampleSession(NOW - 800 * DAY);
  await store.saveSessions([recent, almostAYear, exactlyAYear, justOver, ancient]);

  const removed = await cleanupOldSessions(store, NOW);

  assertEqual(removed, 2);
  const left = (await store.listSessions()).map((s) => s.id);
  assertEqual(left, [recent.id, almostAYear.id, exactlyAYear.id]);
}));

test('cleanup with nothing to delete, and running it twice', () => withStore(async (store) => {
  assertEqual(await cleanupOldSessions(store, NOW), 0, 'empty database');
  await store.saveSession(sampleSession(NOW - 400 * DAY));
  assertEqual(await cleanupOldSessions(store, NOW), 1);
  assertEqual(await cleanupOldSessions(store, NOW), 0, 'second run finds nothing');
}));

test('cleanup does not touch the session in progress', () => withStore(async (store) => {
  const draft = L.newSession(NOW - 400 * DAY);
  await store.saveDraft(draft);
  await cleanupOldSessions(store, NOW);
  assertEqual((await store.loadDraft()).id, draft.id);
}));

/* ---------- Run everything and show the results ---------- */

const resultsList = document.getElementById('results');
let passed = 0;
const failures = [];

for (const { name, fn } of tests) {
  const li = document.createElement('li');
  try {
    await fn();
    passed++;
    li.className = 'pass';
    li.textContent = `✓ ${name}`;
  } catch (err) {
    failures.push({ name, error: String(err.message || err) });
    li.className = 'fail';
    li.textContent = `✗ ${name}`;
    const pre = document.createElement('pre');
    pre.textContent = err.message || String(err);
    li.append(pre);
  }
  resultsList.append(li);
}

const summary = document.getElementById('summary');
summary.textContent = failures.length
  ? `${failures.length} of ${tests.length} tests FAILED`
  : `All ${tests.length} tests passed`;
summary.className = failures.length ? 'fail' : 'pass';

// Lets automated tools read the outcome.
window.testResults = { passed, failed: failures.length, failures };
