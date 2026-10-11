# Workout Log

A simple workout log for iPhone. It's a Progressive Web App (PWA): a website you
add to your Home Screen, where it opens full-screen like a normal app.

- Free to build, host and use: no accounts, no servers, no paid services
- Works offline after the first load
- All data is stored only on your phone (in IndexedDB)
- Sessions older than 12 months are deleted automatically each time the app opens

## Files

| File | What it does |
| --- | --- |
| `index.html` | The four screens (Home, Session, Past Sessions, Details) and the dialogs |
| `styles.css` | Layout and colours, including dark mode and iPhone safe areas |
| `js/app.js` | The user interface: what happens when you tap something |
| `js/logic.js` | The rules: reading what you typed, building sessions, the one-year limit |
| `js/db.js` | Saving and loading data on the phone (IndexedDB) |
| `sw.js` | The service worker that makes the app work offline |
| `manifest.webmanifest` | App name, icon and colours for "Add to Home Screen" |
| `icons/` | App icons (made by `tools/make-icons.py`) |
| `tests/` | Tests. Open `tests/index.html` in a browser to run them |

## Using the app

- **New Session** starts a workout with today's date and time. If a workout is
  already in progress, the tile says **Resume Session**.
- Type an exercise name, the weight, reps and rest, then tap **Add Set**. The
  values stay filled in, so for the next identical set you only tap **Add Set** again.
- Names you've used before are shown as buttons under the name field. Tapping
  one also fills in the weight, reps and rest from the last time you did it.
- **Rest:** type seconds (`90`) or minutes.seconds (`1.30` = 1 min 30 s; the
  number pad has no `:` key). You can also tap one of the quick buttons (1:00, 1:30…).
- Bodyweight exercises: type `,,` in Weight and it turns into **BW**. (An empty weight counts as 0 kg.)
- Tap a set to change or delete it. Tap **Edit** next to an exercise to rename or delete it.
- Everything is saved as you type. If the app gets closed mid-workout, it continues
  where you left off.
- **Finish & Save Session** saves the workout and goes back to the Home screen.

### Backups

Your data lives only on your phone. It is lost if you delete the app from the
Home Screen or clear Safari's website data (Settings → Apps → Safari → Clear History
and Website Data). From time to time, tap **Export data (JSON)** on the Home screen
and choose **Save to Files** (or AirDrop / Mail it to yourself).

To restore, tap **Import backup** and pick the file. Imported sessions are added to
the ones already on the phone; nothing is deleted.

## Publishing on GitHub Pages (free)

1. Create a free account at <https://github.com> (if you don't have one yet).
2. Click **+** (top right) → **New repository**.
   - Repository name: `workout-log`
   - Select **Public**. (Free GitHub Pages needs a public repository. Only the app's
     code is public. Your workout data never leaves your phone.)
   - Click **Create repository**.
3. On the next page, click the link **uploading an existing file**.
4. In Finder, open the `Workout Log` folder and select everything inside it:
   `index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, `README.md` and the
   folders `js`, `icons`, `tests`, `tools`. Drag them into the upload area of the browser.
   Make sure the folders appear with their files (e.g. `js/app.js`).
5. Click **Commit changes** at the bottom.
6. Go to the repository's **Settings** tab → **Pages** (left menu).
   Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
   Under **Branch**, choose `main` and `/ (root)`, then click **Save**.
7. Wait 1–2 minutes and refresh the page. A link will appear at the top:
   `https://YOUR-USERNAME.github.io/workout-log/`. Open it to check that the app loads.

### Installing on your iPhone

1. Open **Safari** on the iPhone (it must be Safari) and go to
   `https://YOUR-USERNAME.github.io/workout-log/`.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**. If you see an **Open as Web App**
   switch, leave it turned on. Tap **Add**.
4. Open the app from the new icon on your Home Screen once while you're online.
   From then on it also works without internet.

Always open the app from the Home Screen icon, not from Safari: the Home Screen app
and Safari keep their data separately.

### Updating the app later

Upload the changed files to the repository in the same way (**Add file** → **Upload files**)
and commit. GitHub Pages updates within a minute or two. The app downloads the new
version in the background the next time you open it, and uses it from the time after
that. Your saved workouts are not affected.

## Running the tests

Open `https://YOUR-USERNAME.github.io/workout-log/tests/` in any browser (or serve the
folder locally, e.g. `python3 -m http.server`, and open `http://localhost:8000/tests/`).
The tests use a separate temporary database, so your real data is never touched.
