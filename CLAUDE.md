# CLAUDE.md

Context for working on this repo. Read before editing `index.html`.

## What this is

A personal daily habit checklist, built for the owner. It installs to an iPhone home
screen and a Mac dock, checkmarks reset at midnight, and the day rolls into a 14-day log
with a streak counter. Optional Supabase sync keeps devices on the same list.

Live at https://colemunro09.github.io/routines/ — GitHub Pages serves `main` at the repo
root. **Pushing to `main` deploys.** Redeploy takes about a minute.

## Hard constraints

- **One file.** `index.html` is the entire app: markup, CSS, and JS inline. No build step,
  no bundler, no framework, no npm, no dependencies. Do not introduce any. The whole point
  is that it can be opened, edited, and re-hosted anywhere with no toolchain.
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
  v: 2,
  quote: "…",        // line above the list
  midQuote: "…",     // line between the first and second section
  sections: [ { id, icon: "sun"|"moon", title, items: [ { id, label } ] } ],
  log: { "2026-08-23": { itemId: 1, … } },   // per-day, per-item checkmarks
  mtime: 1755993600000                        // last local edit, drives sync merge
}
```

`log` keys are **local** dates (`keyOf()`), never UTC — a checkmark belongs to the day the
person experienced, not the day in Greenwich. Deleted items may leave stale ids in `log`;
that's intentional and harmless, since completion is computed against items that currently
exist.

`save()` stamps `mtime` and schedules a push. `saveLocal()` writes without stamping — use
it when applying a *remote* change, or you'll ping-pong.

## Sync design

Supabase Postgres, reached over PostgREST RPC. Two functions, `routines_get(k)` and
`routines_put(k, d)`, both `security definer`. RLS is on for the `routines` table with **no
policies**, so the `anon` key cannot touch the table directly — the functions are the only
door, and each needs the exact secret key. This is what prevents someone with the anon key
from listing every row. The SQL lives in the README and inside the app's sync panel; keep
the three copies identical if you change it.

Config (`{url, anon, key}`) lives in `localStorage` under `routines.cfg`, never in the
repo. A **setup link** base64s that config into the URL hash; on load the app reads it,
saves it, and strips the hash. That link is the entire login — treat it as a credential.

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
verdigris (`#0E6B5E` light, `#4FBFA8` dark) — the single accent, used for checks, progress,
the streak, and the mid-list quote. Keep it to one.

Tap targets are ≥54px tall. `prefers-reduced-motion` kills all transitions — don't add
animation that ignores it.

## Decisions already settled — don't relitigate

- **Hosting is GitHub Pages, not Supabase Storage.** Supabase has no static-site Git
  integration; its GitHub integration is for database migrations. Pages auto-deploys on push.
- **The repo is public** because Pages on a private repo needs a paid GitHub plan, and the
  source contains nothing sensitive.
- **Local storage plus a JSON document** rather than a normalized schema. One user, tiny
  data, and it keeps the app fully functional with sync turned off.
- **No login.** A long secret key in a URL is the whole auth model. This was a deliberate
  call by the owner.

## Known gaps

- **No offline support.** The page needs a network hit to load. A service worker (~30 lines,
  a second file) would fix it — the intended next step, deferred until the app has been
  used for a while.
- No notifications, no widget. Both would require a native app.
- Streak counts only 100% days. Partial days show in the bar chart but don't extend a streak.

## Verifying a change

There are no tests. Before pushing, at minimum:

```bash
node --check <(sed -n '/^<script>/,/^<\/script>/p' index.html | sed '1d;$d')
```

Then open the file, and check: a row toggles and the header count follows; edit mode
renames and reorders and the change survives a reload; both themes are legible (flip the OS
appearance); the layout holds at 375px wide.
