# CLAUDE.md

Context for working on this repo. Read before editing `index.html`.

## What this is

A personal daily habit checklist, built for the owner. It installs to an iPhone home
screen and a Mac dock, checkmarks reset at 2:00am, and the day rolls into a 14-day log
with a streak counter. A standing scratch pad sits under the list. Two more tabs hold
standing lists that never reset: a weekly meal-prep grid and a master grocery list. Optional Supabase sync keeps
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
  and adds a failure mode on a phone with bad signal. The two exceptions are both optional
  and silent until the person configures them on that device: Supabase sync and the
  Routines Console (Ask, and grocery sync with Notion).
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
3. Static markup — sticky header, `#stats`, `#meals`, `#groceries`, `#chat`, `#quoteHost`,
   `#sections`, `#editTools`, `#log`, the FAB, the bottom tab bar
4. `<script>` — one IIFE, in this order: meta injection, storage helpers, `DEFAULT`,
   `LESSONS`, the list constants and `shapeLists`, state load and migration, sync config
   and transport, date helpers, icons, render functions, the meals/groceries/import UI,
   the Ask view and the Notion copy, `render()`, event wiring

The two quote slots are picked each civil day from `LESSONS` plus `quote` and
`midQuote` on the document. Edit mode still edits those two personal lines; it
does not edit the standing questions.

## Data model

```js
{
  v: 3,
  quote: "…",        // your line; joins the daily rotation at the top of the list
  midQuote: "…",     // your line; joins the daily rotation between the first and second section
  scratch: "…",      // standing dump pad — not tied to a day, not cleared at midnight
  sections: [ { id, icon: "sun"|"moon", title, items: [ { id, label } ] } ],
  log: {
    "2026-08-23": {
      d: { itemId: 1, … },   // what was ticked
      n: 7,                  // how many habits the list held that day
      note: "…"              // leftover per-day notes, still shown in stats if present
    }
  },
  groceries: {
    items: [ { id, name, group, store, note, need: true, got: false,
               t: …,         // last edited here (ms)
               s: … } ],     // last matched Notion (ms)
    deleted: [ id ],         // deleted here, not yet sent to Notion
    mtime: …                 // its own clock - see "Sync design"
  },
  meals: {
    slots: ["Breakfast","Lunch","Dinner"],
    options: { main|side|fruit|drink: [ { name, type } ] },   // dropdown contents, grouped by type
    plan: { "0|Breakfast": { main, side, fruit, drink, done, note } },  // 0 = Monday
    mtime: …
  },
  mtime: 1755993600000                        // last local edit, drives sync merge
}
```

`groceries` and `meals` are standing lists, not days: nothing in them touches `log`, the
streaks or the 2am rollover. `store` may list several shops comma-separated; the Shop view
files an item under the first and shows the rest as "also …". `got` is the in-cart tick
while shopping; Finish shopping turns `need` off for everything got. New week clears `done`
and `note` in the meal plan and keeps the choices.

`shapeLists()` fills in either list when missing (meal options start from a generic
`MEAL_SEED`). Run it on **local** state only - load, after a merge, after a restore. Never
on a remote copy before `mergeDocs`, or its empty defaults would look like real data.

Item order lives in the arrays themselves. Dragging a row moves the element in the DOM as
the finger travels and rebuilds every section's `items` from that DOM order on drop, so a
row dragged between sections just changes which array it lands in — which is why an edit
row looks its item up (`sectionOf`) instead of closing over the section it was rendered in.

`log` keys are **local** dates (`keyOf()`), never UTC — a checkmark belongs to the day the
person experienced, not the day in Greenwich. The civil day runs until 2:00am
(`RESET_HOUR`), so 12:40am Saturday still files as Friday. `today()` and `nowDay()` are
the source of that; don't walk a streak or the 14-day log from `new Date()` or the
0–2am window will look like a new empty day.

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

**Through the Routines server (the normal setup).** A device connected to the server
(`routines.ask`) syncs through it: `serverCfg()` stands in for `cfg`, and `rpc()` sends
`/api/doc` `{op:"get"}` / `{op:"put", d}` with the server key. The server holds the
Supabase URL, anon key and the row's secret key and calls the same two functions below,
so devices never hold Supabase details. Through the server an empty row means no device
has saved yet (a wrong key is refused with 401, not an empty row), so the first device
pushes. Its setup link is `#c=` and carries the server address only; the new device types
the server key once. A device that has just connected (`cfg.join`) adopts the server's copy whole instead of
merging: a fresh app's starter list is newer the moment anything on it is ticked, and a
merge would let it overwrite the real one. Connecting deletes any direct-mode config (`routines.cfg`) from the device,
so a switched device holds no Supabase details at all. Everything after this paragraph
describes the older direct mode,
which a device uses only while it isn't connected to a server.


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

**The key field is never prefilled.** `secret()` is called from one place only — the
**Generate a new key** button, shown while there is no config. The panel used to mint a key
automatically for any device with no config and nothing pending, which meant a second device
set up by hand rather than by setup link silently got a key of its own: a second row, a
starter list pushed into it, and a cheerful "Synced". Don't reintroduce a prefill: an
unconfigured device cannot know whether it is the first one, so it must assume it isn't.

An empty row is only ever expected on the device that minted the key, so `cfg.mint` is set
when the key came from that button and cleared after the first successful push. `pull()`
reads it: finding nothing under the key on any *other* device is reported as "No list on
that key" and **nothing is sent**. That push was the second half of the original bug — it
turned a mistyped key into a real second row and then said "Synced". A later local edit will
still create the row via `schedulePush()`; that's deliberate, so a device whose row was
deleted can recover instead of being stuck.

The button itself is hidden when `pending` is set. A device that arrived on a setup link has
positive evidence that another device already holds the key, so offering to mint one there
would contradict the hint right above it. A device with no config *and* no pending setup is
the only place a key can be born.

Merge is last-write-wins on the document by `mtime`, **except** `log`, which merges at the
day level (`Object.assign({}, older.log, newer.log)`). That way a morning checked off on a
phone isn't erased by a laptop that's been open since yesterday. Don't "simplify" this into
a whole-document overwrite.

`groceries` and `meals` also merge on their own, each by its own `mtime`, never the
document's. A habit ticked offline on one device would otherwise roll back a grocery list
edited on another, and an older build that has never seen these fields would erase them
on its next push. Every edit to either list goes through `listStamp()`, which bumps that
list's `mtime` and then saves. "Undo a list change" restores habits only and carries the
current lists across.

Pull happens on load, on focus, and on visibility change. Push is debounced ~1.2s after a
change.

## Import

One paste box, in Today's edit tools and at the foot of Groceries, takes three shapes:
a grocery sheet copied from Sheets or Excel (tab-separated, header row with `Item` and
any of `Need`, `Food group`, `Store`, `Quantity`/`Note`), the same as CSV, or JSON with any
of `habits`, `groceries` and `meals` (options, slots, and a plan of
`{day, meal, main|side|fruit|drink, note}` entries). Matching rows update by name, new ones
are added, nothing is deleted, so running the same import twice is harmless. Habits
dedupe by label across every section and land in a section matched by title.

The owner's real lists come in through this box from a file kept outside the repo. Like
the habits in `DEFAULT`, `MEAL_SEED` stays generic.

## Ask and the Notion copy

The fourth tab talks to the **Routines Console**, a separate repo (`routines-console`) that
runs on Vercel or any Node host (Railway: `npm start`). It runs an AI with Notion tools -
Claude when the server has a Claude key, otherwise OpenAI - and the app labels replies
with whichever answered (`askWho`). The app never calls an AI itself, so no AI key is in
this file.

- `HOME_SERVER` is the owner's server address, built in on purpose: an address is not a
  secret, since every request needs the key, so the connect form asks only for the key
  ("Use a different server" reveals the address field). Never build the key in - the page
  is public, and anything in it is readable by anyone.
- Config is `{url, key}` under `routines.ask`, typed once per device. Like the sync secret
  it is never in the document and never in a setup link. It is also the device's sync
  connection - see "Sync design". A `#c=` link leaves the address in `routines.askPending`
  and the chip says Connect.
- The conversation is plain text under `routines.askLog`: last 40 turns, always starting
  with a user turn, or the server rejects it.
- Each question carries `askContext()`: today's list with ticks, streaks, two weeks of
  scores, the groceries needed by store, and this week's meal plan, computed with the same
  functions the tabs use. Read-only - nothing the server returns changes the app.
- With the console connected, groceries sync with a Notion database **both ways**:
  four seconds after a change, about 3s after the app opens, and on returning to the
  foreground (at most once a minute). The app sends its whole list with each item's `t`
  and `s` plus `deleted`; the console reconciles item by item (`reconcile()` in the
  console repo) and returns the merged list, which replaces the app's.
  - Edited only here since `s`: the app wins. Changed only in Notion: Notion wins. Both:
    the later edit wins; Notion stamps to the minute, so a same-minute tie goes to the app.
  - A row made in Notion (no Routines ID) is claimed: given an id and added here.
  - Deleted here: the id rides in `deleted` and only that row is trashed. An item missing
    here but not in `deleted` - another device added it - comes back instead.
  - Deleted in Notion: dropped here, unless it was edited here since `s`.
  - Every grocery edit must go through `touched(item)` (sets `t`) and `listStamp`. A
    deletion must call `tombstone(id)`. The in-cart tick passes `quiet` to `listStamp`:
    Notion never holds it, so it needn't sync.
  - `groEpoch` counts edits. A reply that arrives after an edit made mid-flight is
    dropped and a fresh sync runs, so a sync can never undo a tap.
- The console allows only `https://colemunro09.github.io` as an origin (`ALLOWED_ORIGINS`).
- The service worker ignores cross-origin requests and anything that isn't GET, so console
  traffic, which carries the key, never lands in the offline cache.

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

Meals and Groceries are built from Today's own parts - `.sec` cards, `.row` lines, `.box`
ticks - so the tabs read as one app; only the week strip and meal tiles are new. A meal
pick is a styled tile with a native `<select>` laid invisibly over it, so a phone opens its
own picker. The stats view already owns `.tile`/`.tiles`; the meal tiles are `.mtile`.

Habit rows are ≥54px tall (`.row` carries `min-height:54px`); the stacked `.btn` controls
are 47px, which still clears the 44pt platform minimum. Grocery rows are 54px, tabs 56px,
and every list control is at least 44px. Meal selects and inputs are 16px so iOS doesn't
zoom on focus. `prefers-reduced-motion` kills all
transitions — don't add animation that ignores it.

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
- Day notes used to be a one-line field on today; that is now a standing scratch pad on
  the document (`scratch`), not `log[day].note`. Older per-day notes still render read-only
  in the stats day detail. Editing one in place would need the detail to stop being an
  `innerHTML` blob.

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
