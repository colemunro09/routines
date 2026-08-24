# CLAUDE.md

Context for working on this repo. Read before editing `index.html`.

## What this is

A personal daily habit checklist, built for the owner. It installs to an iPhone home
screen and a Mac dock, checkmarks reset at midnight, and the day rolls into a 14-day log
with a streak counter. Each day can carry a one-line note. Optional Supabase sync keeps
devices on the same list, and a service worker keeps it opening with no network.

Live at https://colemunro09.github.io/routines/ — GitHub Pages serves `main` at the repo
root. **Pushing to `main` deploys.** Redeploy takes about a minute.

## Hard constraints

- **One file.** `index.html` is the entire app: markup, CSS, and JS inline. No build step,
  no bundler, no framework, no npm, no dependencies. Do not introduce any. The whole point
  is that it can be opened, edited, and re-hosted anywhere with no toolchain. Two companion
  files sit beside it, and both are optional in the sense that the app runs without either:
  - `icon.png` (180x180, the CM mark on black) — iOS ignores `rel="icon"` and data URIs
    when adding to the home screen, so the touch icon has to be a real file. Missing, the
    home screen just falls back to a screenshot.
  - `sw.js` — the offline shell, ~45 lines, no dependencies. It is registered only from a
    secure origin that isn't `file:`, so a local copy or an Artifact preview skips it and
    behaves exactly as the app did before it existed.
- **No `<!doctype>`, `<html>`, `<head>`, or `<body>` tags** — the file opens with `<title>`
  and the font `<link>`. It renders fine as a standalone page and stays publishable as a
  Claude Artifact. Meta tags for iOS standalone mode are injected by JS at startup.
- **The only external request is Google Fonts.** Anything else breaks the Artifact preview
  and adds a failure mode on a phone with bad signal.
- ES5-flavored JS (`var`, `function`, no optional chaining). Not a hard requirement, but the
  file is consistent — match it.

## Personal data stays out of this repo

The repo is public. The habit list committed in `DEFAULT` is a **generic starter set**, not
the owner's actual routine — that lives only in Supabase, loaded at runtime. If you edit
`DEFAULT`, keep it generic. Never commit the owner's real habits, their Supabase project
URL, anon key, or secret key. None of those are in the repo today; keep it that way.

## File layout

`index.html` reads top to bottom in this order:

1. `<title>` and the Google Fonts link
2. `<style>` — CSS custom properties in `:root`, then components
3. Static markup — sticky header, `#quoteHost`, `#sections`, `#editTools`, `#log`, the FAB
4. `<script>` — one IIFE, in this order: meta injection, storage helpers, `DEFAULT`, state
   load and migration, sync config and transport, date helpers, icons, render functions,
   event wiring

## Data model

```js
{
  v: 3,
  quote: "…",        // line above the list
  midQuote: "…",     // line between the first and second section
  sections: [ { id, icon: "sun"|"moon", title, items: [ { id, label } ] } ],
  log: {
    "2026-08-23": {
      d: { itemId: 1, … },   // what was ticked
      n: 7,                  // how many habits the list held that day
      note: "…"              // optional, one line about the day
    }
  },
  mtime: 1755993600000                        // last local edit, drives sync merge
}
```

Item order lives in the arrays themselves. Dragging a row moves the element in the DOM as
the finger travels and rebuilds every section's `items` from that DOM order on drop, so a
row dragged between sections just changes which array it lands in — which is why an edit
row looks its item up (`sectionOf`) instead of closing over the section it was rendered in.

`log` keys are **local** dates (`keyOf()`), never UTC — a checkmark belongs to the day the
person experienced, not the day in Greenwich.

**`n` is the point of v3 and must not be dropped.** Score a past day against today's list
and the past changes every time the list does: add a habit this morning and a 6/6 Tuesday
silently becomes 6/7, breaking a streak nobody broke. So:

- **Today** is still moving. It scores against the list as it stands, `touchToday()` keeps
  `n` current, and ticks belonging to a habit deleted mid-day go with it.
- **A day that is over** scores against `n`, and its numerator is every tick it holds —
  including ticks for habits since deleted, because the day was whole at the time. Stale
  ids in `d` are now load-bearing, not just harmless.
- A day with no record at all is 0 either way, so the missing `n` never matters.

`migrate()` runs on load, on any doc pulled from Supabase, and on anything restored from a
backup, so a v2 document can arrive from any of those doors and only get shaped once. It
freezes `n` for old days at the list length it finds — the best guess left — and the result
is written straight back to local storage so each device stamps it once, early.

`save()` stamps `mtime` and schedules a push. `saveLocal()` writes without stamping — use
it when applying a *remote* change, or you'll ping-pong.

## Sync design

Supabase Postgres, reached over PostgREST RPC. Two functions, `routines_get(k)` and
`routines_put(k, d)`, both `security definer`. RLS is on for the `routines` table with **no
policies**, so the `anon` key cannot touch the table directly — the functions are the only
door, and each needs the exact secret key. This is what prevents someone with the anon key
from listing every row. The SQL is run once per Supabase project and lives **only in the
README** — the app's sync panel used to carry a copy and no longer does, so there are two
copies to keep in step: the README and what is actually deployed in the database.

Config (`{url, anon, key}`) lives in `localStorage` under `routines.cfg`, never in the
repo. A **setup link** base64s `{url, anon}` — **never `key`** — into the URL hash; on load
the app saves that as a *pending* config under `routines.pending`, strips the hash, and asks
for the secret key before sync turns on. Base64 is not encryption, so anything put in that
hash is public the moment the link is; don't put the key back in it.

Links made before this change did carry the key, and `readHash()` still honours them so
existing devices keep working. That's a compatibility ramp, not a design goal.

The panel prefills a freshly minted `secret()` **only** when there is no config and nothing
pending. A device arriving on a setup link must get an empty field — minting a key there
silently creates a second row and the two devices never sync, with no error shown.

Merge is last-write-wins on the document by `mtime`, **except** `log`, which merges at the
day level (`Object.assign({}, older.log, newer.log)`). That way a morning checked off on a
phone isn't erased by a laptop that's been open since yesterday. Don't "simplify" this into
a whole-document overwrite.

Pull happens on load, on focus, and on visibility change. Push is debounced ~1.2s after a
change.

## Design system

All color is CSS custom properties on `:root`. **Never write a literal color in a
component rule.** Themes are defined three times, and all three must stay in sync:

1. `:root` — complete light palette
2. `@media (prefers-color-scheme: dark)` scoped to `:root:not([data-theme="light"])`
3. `:root[data-theme="dark"]`

Number 3 exists because the Artifact viewer stamps `data-theme`; a browser only ever uses
1 and 2. A color defined only inside a media query renders one theme's text on the other
theme's background — the classic bug here.

Type: **Bricolage Grotesque** for the wordmark only, **IBM Plex Sans** for UI, **IBM Plex
Mono** for dates, counts, section eyebrows, and anything tabular. Accent is a deep
crimson (`#A31F34` light, `#FF3B4E` dark) — the single accent, used for checks, progress,
the streak, and the mid-list quote. Keep it to one, and read it from `:root` rather than
from this file, which has been wrong about it before.

Tap targets are ≥54px tall. `prefers-reduced-motion` kills all transitions — don't add
animation that ignores it.

## Decisions already settled — don't relitigate

- **Hosting is GitHub Pages, not Supabase Storage.** Supabase has no static-site Git
  integration; its GitHub integration is for database migrations. Pages auto-deploys on push.
- **The repo is public** because Pages on a private repo needs a paid GitHub plan, and the
  source contains nothing sensitive.
- **Local storage plus a JSON document** rather than a normalized schema. One user, tiny
  data, and it keeps the app fully functional with sync turned off.
- **No login.** A long secret key is the whole auth model. This was a deliberate call by
  the owner. It no longer travels in the URL, though — it's typed once per device.

## Known gaps

- No notifications, no widget. Both would require a native app.
- **No haptics on iOS.** `toggle()` calls `navigator.vibrate`, which Android and desktop
  honour and iOS Safari does not implement at all. There is no web API for it; the only
  known workaround is making the real tap target an `<input type="checkbox" switch>`, which
  is Safari-only, undocumented behaviour, and would mean rebuilding `checkRow` and its CSS.
  Not worth it unless it's asked for.
- Streak counts only 100% days. Partial days show in the bar chart but don't extend a streak.
- Every habit is every day. There is no per-habit schedule, and this is deliberate — the
  owner's list really is daily. Don't add one unasked.
- Day notes are written on the list for today only; older notes show read-only in the stats
  day detail. Editing one in place would need the detail to stop being an `innerHTML` blob.

## Verifying a change

There are no tests. Before pushing, at minimum:

```bash
node --check <(sed -n '/^<script>/,/^<\/script>/p' index.html | sed '1d;$d')
```

Then open the file, and check: a row toggles and the header count follows; edit mode
renames, and dragging a row by its grip handle reorders it — within a section and across
into the other one — and the change survives a reload; both themes are legible (flip the OS
appearance); the layout holds at 375px wide.

Opening `index.html` off the disk won't exercise the service worker — it needs an origin:

```bash
python3 -m http.server 8765
```

Two things about that worker will trip you up. It serves the cached copy first and fetches
the new one behind it, so **an edit shows up on the second reload, not the first** — reload
twice before believing a change didn't land. And to test offline properly, stop the server
and reload; DevTools' offline checkbox is fine too. If you need a clean slate, unregister
the worker and delete the `routines-v1` cache.

Worth re-checking after anything that touches the log: add a habit and confirm the days
behind it keep their percentages and the streak survives.
