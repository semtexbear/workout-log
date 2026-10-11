/**
 * app.js – The user interface.
 *
 * The app has four screens (see index.html). Which one is shown depends on
 * the part of the address after "#":
 *
 *   #/              Home (two tiles)
 *   #/session       The session in progress
 *   #/history       Past Sessions list
 *   #/history/<id>  Details of one past session
 *
 * Data lives in IndexedDB (db.js); the rules live in logic.js.
 */

import * as L from './logic.js';
import { openDatabase, cleanupOldSessions } from './db.js';

/* ------------------------------------------------------------------ */
/* App state                                                           */
/* ------------------------------------------------------------------ */

const state = {
  store: null,     // database connection (from db.js)
  draft: null,     // the session in progress, or null
  sessions: [],    // saved sessions from the last 12 months, newest first
  exercises: [],   // known exercises for suggestions (see L.buildExerciseIndex)
};

/** Shortcut for document.querySelector. */
const $ = (selector) => document.querySelector(selector);

init();

async function init() {
  registerServiceWorker();
  // Ask the browser to treat our data as important (not "clearable cache").
  navigator.storage?.persist?.().catch(() => {});

  try {
    state.store = await openDatabase();
    await cleanupOldSessions(state.store, Date.now());
    state.draft = await state.store.loadDraft();
    await reloadSessions();
  } catch (err) {
    console.error(err);
    document.body.textContent = 'Sorry – the app could not open its database. ' + err;
    return;
  }

  wireEvents();
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', onVisibilityChange);
  render();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker:', err));
  }
}

/** Re-reads the saved sessions from the database. */
async function reloadSessions() {
  state.sessions = await state.store.listSessions(L.oneYearBefore(Date.now()));
  state.exercises = L.buildExerciseIndex(state.sessions);
}

/**
 * iPhone apps are often only "paused" in the background. When the app comes
 * back, run the one-year cleanup again; when it goes away, save right now.
 */
async function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    saveDraftNow();
    return;
  }
  const removed = await cleanupOldSessions(state.store, Date.now());
  if (removed > 0) await reloadSessions();
  const { screen } = currentRoute();
  if (screen !== 'session') render(); // don't disturb a form being typed in
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function currentRoute() {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'history' && id) return { screen: 'detail', id: decodeURIComponent(id) };
  return { screen: name || 'home', id: null };
}

/**
 * Goes to another screen. With replace = true the current screen is replaced
 * in the history (so "back" doesn't return to e.g. a deleted session).
 */
function go(hash, replace = false) {
  if (replace) {
    history.replaceState(null, '', hash);
    render();
  } else {
    location.hash = hash;
  }
}

/** Shows the screen that matches the address and fills it with data. */
function render() {
  const route = currentRoute();
  const screen = document.getElementById(`screen-${route.screen}`);
  if (!screen) return go('#/', true);
  if (route.screen === 'session' && !state.draft) return go('#/', true);

  for (const s of document.querySelectorAll('.screen')) s.hidden = s !== screen;
  window.scrollTo(0, 0);

  if (route.screen === 'home') renderHome();
  if (route.screen === 'session') renderSession();
  if (route.screen === 'history') renderHistory();
  if (route.screen === 'detail') renderDetail(route.id);
}

/* ------------------------------------------------------------------ */
/* Event wiring (done once at start-up)                                */
/* ------------------------------------------------------------------ */

function wireEvents() {
  // Any button with data-go="#/..." is a simple navigation link.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-go]');
    if (link) go(link.dataset.go);
  });
  // Quiet header: when a screen's large title scrolls up under the top bar,
  // the bar gets the class "scrolled", which fades in its small title.
  for (const title of document.querySelectorAll('.large-title')) {
    const bar = title.closest('.screen').querySelector('.bar');
    new IntersectionObserver(
      ([entry]) => bar.classList.toggle('scrolled', !entry.isIntersecting && entry.boundingClientRect.top < 100),
      { rootMargin: '-60px 0px 0px 0px' }, // the bar is about 50–60px tall
    ).observe(title);
  }
  // Any button with data-close closes its dialog.
  for (const btn of document.querySelectorAll('dialog [data-close]')) {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  }

  // Home
  $('#tile-new').addEventListener('click', startOrResumeSession);
  $('#tile-past').addEventListener('click', () => go('#/history'));
  $('#export-btn').addEventListener('click', exportData);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importData);

  // Session in progress
  $('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); addSetFromForm(); });
  $('#entry-form').addEventListener('input', onFormInput);
  $('#f-name').addEventListener('focus', renderSuggestions);
  // The keyboard's "next" key on the name field jumps to Target reps instead of adding the set.
  $('#f-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); form.target().focus(); }
  });
  $('#f-name').addEventListener('input', syncTargetToName);
  $('#f-target').addEventListener('input', () => { targetIsAuto = false; });
  for (const chip of document.querySelectorAll('[data-rest]')) {
    chip.addEventListener('click', () => {
      $('#f-rest').value = L.formatRest(Number(chip.dataset.rest));
      onFormInput();
    });
  }
  $('#finish-btn').addEventListener('click', finishSession);
  $('#discard-btn').addEventListener('click', discardSession);

  // Dialogs (pressing Return in a dialog's text field counts as "Save")
  $('#set-dialog form').addEventListener('submit', (e) => { e.preventDefault(); saveSetDialog(); });
  $('#exercise-dialog form').addEventListener('submit', (e) => { e.preventDefault(); saveExerciseDialog(); });
  $('#set-save-btn').addEventListener('click', saveSetDialog);
  $('#set-delete-btn').addEventListener('click', deleteSetDialog);
  $('#exercise-save-btn').addEventListener('click', saveExerciseDialog);
  $('#exercise-delete-btn').addEventListener('click', deleteExerciseDialog);

  // Past session details
  $('#delete-session-btn').addEventListener('click', deleteShownSession);
}

/* ------------------------------------------------------------------ */
/* Home screen                                                         */
/* ------------------------------------------------------------------ */

function renderHome() {
  $('#home-date').textContent = L.formatLongDate(Date.now());

  if (state.draft) {
    $('#tile-new-label').textContent = 'Resume Session';
    $('#tile-new-sub').textContent =
      `Started ${L.formatTime(state.draft.startedAt)} · ${L.countSets(state.draft)} sets`;
  } else {
    $('#tile-new-label').textContent = 'New Session';
    $('#tile-new-sub').textContent = 'Start logging';
  }

  const n = state.sessions.length;
  $('#tile-past-sub').textContent = n === 0 ? 'None yet' : `${n} ${n === 1 ? 'session' : 'sessions'}`;
}

async function startOrResumeSession() {
  if (!state.draft) {
    state.draft = L.newSession(Date.now());
    await state.store.saveDraft(state.draft);
  }
  go('#/session');
}

/* ------------------------------------------------------------------ */
/* Session in progress                                                 */
/* ------------------------------------------------------------------ */

const form = {
  name: () => $('#f-name'),
  target: () => $('#f-target'),
  weight: () => $('#f-weight'),
  reps: () => $('#f-reps'),
  rest: () => $('#f-rest'),
  note: () => $('#f-note'),
};

/** Reads the entry fields as plain text. */
function readForm() {
  return {
    name: form.name().value,
    target: form.target().value,
    weight: form.weight().value,
    reps: form.reps().value,
    rest: form.rest().value,
    note: form.note().value,
  };
}

function fillForm(values = {}) {
  for (const field of Object.keys(form)) form[field]().value = values[field] ?? '';
}

/**
 * True while the Target reps field holds a value the app filled in (or is
 * empty), false once the user has typed a target themselves.
 */
let targetIsAuto = true;

/**
 * When the exercise name changes, show that exercise's target (from this
 * session or last time), so a target never sticks to the wrong exercise.
 * A target the user typed themselves is left alone.
 */
function syncTargetToName() {
  if (!targetIsAuto && form.target().value.trim()) return;
  form.target().value = L.formatTarget(lastTargetFor(form.name().value));
  targetIsAuto = true;
}

/** Puts a saved set's values into the weight/reps/rest fields. */
function fillFormFromSet(set) {
  form.weight().value = L.formatWeight(set.weight);
  form.reps().value = String(set.reps);
  form.rest().value = set.rest == null ? '' : L.formatRest(set.rest);
}

function renderSession() {
  $('#session-date').textContent = L.formatDateTime(state.draft.startedAt);
  fillForm(state.draft.form); // restore half-typed values after a restart
  $('#entry-error').textContent = '';
  renderExerciseList();
  renderSuggestions();
}

/** Draws the exercises and sets logged so far. */
function renderExerciseList(highlight = null) {
  const list = $('#exercise-list');
  list.replaceChildren();

  if (state.draft.exercises.length === 0) {
    list.append(el('p', { class: 'empty' }, 'No sets yet. Enter an exercise above and tap “Add Set”.'));
    return;
  }

  // The exercise worked on most recently is shown first.
  for (const { ex, exIndex } of L.exercisesNewestFirst(state.draft)) {
    list.append(exerciseCard(ex, {
      onEditExercise: () => openExerciseDialog(exIndex),
      onEditSet: (setIndex) => openSetDialog(exIndex, setIndex),
      onAddMore: () => prepareNextSet(exIndex),
      highlightSet: highlight?.exIndex === exIndex ? highlight.setIndex : null,
    }));
  }

  // Make the new set visible and briefly highlight it.
  list.querySelector('.flash')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * One exercise as a card with its sets. Used both in the session in progress
 * (with edit buttons) and in the read-only past session details.
 */
function exerciseCard(ex, { onEditExercise, onEditSet, onAddMore, highlightSet = null } = {}) {
  const editable = Boolean(onEditSet);

  const rows = ex.sets.map((set, i) => {
    const content = [
      el('span', { class: 'set-num' }, String(i + 1)),
      el('span', { class: 'set-main' }, L.formatSet(set)),
      el('span', { class: 'set-rest' }, `rest ${L.formatRest(set.rest)}`),
    ];
    const row = editable
      ? el('button', { class: 'set-row', type: 'button', 'aria-label': `Edit set ${i + 1}`, onclick: () => onEditSet(i) }, content)
      : el('div', { class: 'set-row' }, content);
    if (i === highlightSet) row.classList.add('flash');
    return el('li', {}, row);
  });

  return el('article', { class: 'card exercise' },
    el('header', { class: 'exercise-head' },
      el('div', { class: 'exercise-title' },
        el('h3', {}, ex.name),
        ex.target && el('span', { class: 'target' }, `Target ${L.formatTarget(ex.target)}`)),
      editable && el('button', { class: 'small-btn', type: 'button', onclick: onEditExercise }, 'Edit')),
    ex.note && el('p', { class: 'exercise-note' }, ex.note),
    el('ol', { class: 'sets' }, rows),
    editable && el('button', { class: 'add-more', type: 'button', onclick: onAddMore }, '+ Add another set'),
  );
}

/** Autosave: every keystroke updates the draft, saved shortly after. */
function onFormInput(e) {
  if (!state.draft) return;
  state.draft.form = readForm();
  scheduleDraftSave();
  if (!e || e.target === form.name()) renderSuggestions();
  $('#entry-error').textContent = '';
}

/** Shows exercise name suggestions and "last time" info under the name field. */
function renderSuggestions() {
  if (!state.draft) return;
  const typed = form.name().value;

  // Exercises from this session first, then from past sessions.
  const names = [];
  const seen = new Set();
  for (const name of [...state.draft.exercises.map((e) => e.name).reverse(), ...state.exercises.map((e) => e.name)]) {
    const key = L.normalizeName(name);
    if (!seen.has(key)) { seen.add(key); names.push(name); }
  }

  const box = $('#name-suggestions');
  box.replaceChildren(...L.suggestNames(names, typed).map((name) =>
    el('button', { class: 'chip', type: 'button', onclick: () => pickExercise(name) }, name)));

  // "Last time: 60 kg × 8" when the typed name is a known exercise.
  const last = lastSetFor(typed);
  $('#last-time').textContent = last ? `Last: ${L.formatSet(last)} · rest ${L.formatRest(last.rest)}` : '';
}

/** The most recent set of an exercise: from this session, else from the past. */
function lastSetFor(name) {
  const key = L.normalizeName(name);
  if (!key) return null;
  const current = state.draft?.exercises.find((ex) => L.normalizeName(ex.name) === key);
  if (current?.sets.length) return current.sets[current.sets.length - 1];
  return state.exercises.find((ex) => ex.key === key)?.lastSet ?? null;
}

/** An exercise's target rep range: from this session, else from last time. */
function lastTargetFor(name) {
  const key = L.normalizeName(name);
  if (!key) return null;
  const current = state.draft?.exercises.find((ex) => L.normalizeName(ex.name) === key);
  if (current?.target) return current.target;
  return state.exercises.find((ex) => ex.key === key)?.target ?? null;
}

/** A suggestion was tapped: fill in the name, its target and the last used numbers. */
function pickExercise(name) {
  form.name().value = name;
  form.target().value = L.formatTarget(lastTargetFor(name));
  targetIsAuto = true;
  const last = lastSetFor(name);
  if (last) fillFormFromSet(last);
  onFormInput();
}

/** "+ Add another set" on a card: load that exercise into the form. */
function prepareNextSet(exIndex) {
  pickExercise(state.draft.exercises[exIndex].name);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#entry-form').classList.remove('pulse');
  void $('#entry-form').offsetWidth; // restart the CSS animation
  $('#entry-form').classList.add('pulse');
}

/**
 * Checks parsed set values. Returns an error message, or '' if all is fine.
 * An empty weight counts as 0 kg (bodyweight exercises).
 */
function validateSet({ weight, reps, rest }) {
  if (Number.isNaN(weight)) return 'Weight must be a number, e.g. 22.5';
  if (reps === null) return 'Please enter the number of reps.';
  if (Number.isNaN(reps)) return 'Reps must be a whole number, e.g. 8';
  if (Number.isNaN(rest)) return 'Rest: seconds (90) or minutes.seconds (1.30)';
  return '';
}

/** Checks a parsed target rep range. Returns an error message, or ''. */
function validateTarget(target) {
  return Number.isNaN(target) ? 'Target reps: e.g. 8.12 for 8–12, or just 5' : '';
}

function parseSetFields(weightText, repsText, restText) {
  return {
    weight: L.parseWeight(weightText),
    reps: L.parseReps(repsText),
    rest: L.parseRest(restText),
  };
}

function addSetFromForm() {
  const name = L.cleanName(form.name().value);
  if (!name) return showEntryError('Please enter an exercise name.');

  const set = parseSetFields(form.weight().value, form.reps().value, form.rest().value);
  const target = L.parseTarget(form.target().value);
  const error = validateSet(set) || validateTarget(target);
  if (error) return showEntryError(error);

  const position = L.addSet(state.draft, name, { ...set, weight: set.weight ?? 0 },
    { target, note: form.note().value });
  // Keep the numbers in the form (the next set is usually the same). The note
  // is now shown on the exercise card, so the field is emptied.
  form.note().value = '';
  targetIsAuto = true;
  state.draft.form = readForm();
  saveDraftNow();

  document.activeElement?.blur(); // close the keyboard so the new set is visible
  renderExerciseList(position);
  renderSuggestions();
}

function showEntryError(message) {
  $('#entry-error').textContent = message;
}

/* ---------- Autosave ---------- */

let saveTimer = null;

function scheduleDraftSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraftNow, 400);
}

function saveDraftNow() {
  clearTimeout(saveTimer);
  if (!state.draft) return;
  state.store.saveDraft(state.draft).catch((err) => {
    console.error(err);
    toast('Could not save – please try again');
  });
}

/* ---------- Finish / discard ---------- */

async function finishSession() {
  const session = L.prepareForSave(state.draft, Date.now());
  if (!session) {
    const discard = await confirmDialog({
      title: 'Nothing to save',
      message: 'This session has no sets yet. Discard it?',
      confirmLabel: 'Discard',
    });
    if (discard) await dropDraft();
    return;
  }

  const draft = state.draft;
  clearTimeout(saveTimer);
  state.draft = null; // stops any further autosave of the draft
  try {
    await state.store.finishSession(session);
  } catch (err) {
    console.error(err);
    state.draft = draft;
    toast('Could not save the session – please try again');
    return;
  }
  await reloadSessions();
  toast('Session saved ✓');
  go('#/', true);
}

async function discardSession() {
  const ok = await confirmDialog({
    title: 'Discard session?',
    message: 'All exercises and sets of this session will be lost.',
    confirmLabel: 'Discard',
  });
  if (ok) await dropDraft();
}

async function dropDraft() {
  clearTimeout(saveTimer);
  state.draft = null;
  await state.store.clearDraft();
  go('#/', true);
}

/* ---------- Edit set dialog ---------- */

let editing = null; // { exIndex, setIndex } of the set / exercise being edited

function openSetDialog(exIndex, setIndex) {
  editing = { exIndex, setIndex };
  const ex = state.draft.exercises[exIndex];
  const set = ex.sets[setIndex];
  $('#set-dialog-title').textContent = `${ex.name} – set ${setIndex + 1}`;
  $('#d-weight').value = L.formatWeight(set.weight);
  $('#d-reps').value = String(set.reps);
  $('#d-rest').value = set.rest == null ? '' : L.formatRest(set.rest);
  $('#set-dialog-error').textContent = '';
  $('#set-dialog').showModal();
}

function saveSetDialog() {
  const set = parseSetFields($('#d-weight').value, $('#d-reps').value, $('#d-rest').value);
  const error = validateSet(set);
  if (error) {
    $('#set-dialog-error').textContent = error;
    return;
  }
  L.updateSet(state.draft, editing.exIndex, editing.setIndex, { ...set, weight: set.weight ?? 0 });
  saveDraftNow();
  $('#set-dialog').close();
  renderExerciseList();
  renderSuggestions();
}

function deleteSetDialog() {
  L.removeSet(state.draft, editing.exIndex, editing.setIndex);
  saveDraftNow();
  $('#set-dialog').close();
  renderExerciseList();
  renderSuggestions();
  toast('Set deleted');
}

/* ---------- Edit exercise dialog ---------- */

function openExerciseDialog(exIndex) {
  editing = { exIndex };
  const ex = state.draft.exercises[exIndex];
  $('#d-name').value = ex.name;
  $('#d-target').value = L.formatTarget(ex.target);
  $('#d-note').value = ex.note ?? '';
  $('#exercise-dialog-error').textContent = '';
  $('#exercise-dialog').showModal();
}

function saveExerciseDialog() {
  const name = L.cleanName($('#d-name').value);
  const target = L.parseTarget($('#d-target').value);
  const error = name ? validateTarget(target) : 'Please enter a name.';
  if (error) {
    $('#exercise-dialog-error').textContent = error;
    return;
  }
  L.updateExercise(state.draft, editing.exIndex, { name, target, note: $('#d-note').value });
  saveDraftNow();
  $('#exercise-dialog').close();
  renderExerciseList();
  renderSuggestions();
}

async function deleteExerciseDialog() {
  const ex = state.draft.exercises[editing.exIndex];
  $('#exercise-dialog').close();
  const ok = await confirmDialog({
    title: `Delete “${ex.name}”?`,
    message: `Its ${ex.sets.length} ${ex.sets.length === 1 ? 'set' : 'sets'} will be removed from this session.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  L.removeExercise(state.draft, editing.exIndex);
  saveDraftNow();
  renderExerciseList();
  renderSuggestions();
}

/* ------------------------------------------------------------------ */
/* Past Sessions                                                       */
/* ------------------------------------------------------------------ */

function renderHistory() {
  const list = $('#history-list');
  list.replaceChildren();

  if (state.sessions.length === 0) {
    list.append(el('p', { class: 'empty' }, 'No saved sessions yet.'));
    return;
  }

  let month = '';
  for (const s of state.sessions) {
    // A heading whenever a new month starts (the list is newest first).
    const m = L.formatMonth(s.startedAt);
    if (m !== month) {
      month = m;
      list.append(el('h2', { class: 'month' }, m));
    }
    list.append(el('button', {
      class: 'session-row',
      type: 'button',
      onclick: () => go(`#/history/${encodeURIComponent(s.id)}`),
    },
      el('span', { class: 'session-date' }, L.formatDateTime(s.startedAt)),
      el('span', { class: 'session-summary' }, L.summarize(s)),
      el('span', { class: 'session-names' }, s.exercises.map((e) => e.name).join(', ')),
    ));
  }
}

let shownSessionId = null;

async function renderDetail(id) {
  const session = state.sessions.find((s) => s.id === id) ?? await state.store.getSession(id);
  if (!session) return go('#/history', true);
  shownSessionId = id;

  $('#detail-date').textContent = L.formatDateTime(session.startedAt);
  $('#detail-bar-title').textContent = L.formatShortDate(session.startedAt);
  const duration = session.finishedAt ? ` · ${L.formatDuration(session.finishedAt - session.startedAt)}` : '';
  $('#detail-meta').textContent = L.summarize(session) + duration;
  $('#detail-list').replaceChildren(...session.exercises.map((ex) => exerciseCard(ex)));
}

async function deleteShownSession() {
  const ok = await confirmDialog({
    title: 'Delete this session?',
    message: 'It will be permanently deleted from this phone. This cannot be undone.',
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  await state.store.deleteSession(shownSessionId);
  await reloadSessions();
  toast('Session deleted');
  go('#/history', true);
}

/* ------------------------------------------------------------------ */
/* Backup: export & import                                             */
/* ------------------------------------------------------------------ */

/**
 * Saves all sessions as a .json file. On iPhone this opens the Share sheet
 * ("Save to Files", AirDrop, Mail…); elsewhere the file is downloaded.
 */
async function exportData() {
  const json = L.buildBackup(state.sessions, Date.now());
  const filename = `workout-log-${L.isoDate(Date.now())}.json`;
  const file = new File([json], filename, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // the user closed the share sheet
      // Otherwise fall back to a normal download below.
    }
  }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Reads a backup file and adds its sessions (existing ones are kept). */
async function importData(e) {
  const file = e.target.files[0];
  e.target.value = ''; // so the same file can be picked again later
  if (!file) return;

  let sessions;
  try {
    sessions = L.parseBackup(await file.text());
  } catch (err) {
    toast(err.message);
    return;
  }
  const ok = await confirmDialog({
    title: `Import ${sessions.length} sessions?`,
    message: 'They are added to the sessions on this phone. Sessions older than 12 months are skipped.',
    confirmLabel: 'Import',
    danger: false,
  });
  if (!ok) return;

  await state.store.saveSessions(sessions);
  await cleanupOldSessions(state.store, Date.now());
  await reloadSessions();
  renderHome();
  toast('Backup imported ✓');
}

/* ------------------------------------------------------------------ */
/* Small UI helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Creates an element. Text is always inserted as plain text (never as HTML),
 * so names typed by the user can't break the page.
 *   el('button', { class: 'chip', onclick: fn }, 'Label')
 */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

/** Shows a short message at the bottom of the screen for a moment. */
let toastTimer = null;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/** An "Are you sure?" dialog. Resolves to true if the user confirmed. */
function confirmDialog({ title, message, confirmLabel = 'OK', danger = true }) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  const ok = $('#confirm-ok');
  ok.textContent = confirmLabel;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dialog.showModal();
  return new Promise((resolve) => {
    const dialogForm = dialog.querySelector('form');
    // Tapping either button submits the form (which closes the dialog);
    // e.submitter is the button that was tapped.
    const onSubmit = (e) => done(e.submitter?.value === 'ok');
    const onCancel = () => done(false); // Escape key
    function done(confirmed) {
      dialogForm.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onCancel);
      resolve(confirmed);
    }
    dialogForm.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);
  });
}
