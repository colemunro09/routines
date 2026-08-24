# Routines

A daily habit checklist that installs to your phone's home screen and your computer's dock.
One HTML file, plus an icon and a small offline worker. No build step, no framework, no
dependencies.

Check things off, and at midnight the list clears itself and the day gets filed into a
running log. Optional sync through Supabase keeps every device on the same list. Once it
has loaded on a device it opens with no network at all.

## Using it

- Tap a row to check it off.
- **Edit list** (bottom right) — rename, delete, and add habits; add or remove whole
  sections; edit both quote lines. Tap **Done** to go back.
- To reorder, drag a habit by the grip handle on its left. Drop it anywhere in either
  section — dragging one from Morning into Evening moves it there. With a keyboard,
  focus a handle and use the up and down arrow keys.
- **Today** — one line about the day, under the list. It's filed with the day and shows up
  again under that day in the stats view.
- The bar chart at the bottom shows the last 14 days. The streak counts consecutive days
  at 100%; today only breaks it once the day is over.
- A day is scored against the list as it stood that day. Adding or deleting a habit changes
  today and leaves your history where it was.

### Offline

After the first load it keeps a copy of itself on the device, so it opens on a plane or in a
tunnel — checkmarks and notes go to local storage and sync catches up next time there's a
network. New versions arrive quietly: the app opens from its copy and fetches the update
behind it, so a change lands on the *next* open after the one where it downloaded.

### Install it

- **iPhone / iPad** — open in Safari, Share, *Add to Home Screen*.
- **Mac** — Safari, File, *Add to Dock*. Or Chrome and press the install icon in the address bar.

## Sync (optional)

Without it, everything lives in one browser's local storage on one device. With it, the
same list and the same checkmarks appear everywhere.

1. In your Supabase project, open the **SQL Editor** and run the block below.
2. Open the app, then **Edit list → Sync across devices**. Paste your **Project URL** and
   **anon public** key from *Project Settings → API*. A secret key is generated for you.
3. Press **Turn on sync**, then **Copy setup link**, and open that link on your other
   devices. The link carries the project URL and anon key, applies them, and removes itself
   from the address bar.
4. On each of those devices the app asks for the secret key. Get it from **Copy secret key**
   on the first device and paste it in. It must match exactly — a different key reads a
   different row, which means a second, empty list and no syncing.

```sql
create table if not exists routines (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table routines enable row level security;

create or replace function routines_get(k text)
returns jsonb language sql security definer set search_path = public as $$
  select data from routines where key = k;
$$;

create or replace function routines_put(k text, d jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  insert into routines(key, data) values (k, d)
  on conflict (key) do update set data = excluded.data, updated_at = now()
  returning updated_at into ts;
  return ts;
end;
$$;

revoke all on function routines_get(text) from public;
revoke all on function routines_put(text, jsonb) from public;
grant execute on function routines_get(text) to anon;
grant execute on function routines_put(text, jsonb) to anon;
```

Row-level security is on with no policies, so the `anon` key cannot read or write the table
directly. The only way in is those two functions, and both need your exact secret key —
which means the table can't be listed or enumerated.

**The secret key is the entire login.** The setup link deliberately does *not* contain it,
so a leaked link on its own opens nothing — it only names the project. Guard the key itself.
Anyone holding it, along with the project URL and anon key, can read and change the list.

To rotate: change the secret key in the sync panel on one device, then re-enter the new key
on the others. The old key's row is left behind in the table, holding whatever it last had.

### How conflicts resolve

The newer edit wins for the list itself, but checkmarks merge day by day — so a morning
checked off on your phone survives a laptop that has been open since yesterday. Offline,
the app keeps working locally and catches up on the next open.

## Editing the UI

Every color, radius, and shadow is a CSS custom property in the `:root` block at the top of
`index.html`; both light and dark themes are defined there. Change a value, commit, and
GitHub Pages redeploys.

Because your data lives in Supabase, replacing the HTML never touches your history.

## Data, in one place

- **Supabase** — your list, your checkmarks, and your notes.
- **This repo** — the app itself. No keys, no personal data.
- **Your browser's local storage** — a working copy, plus your Supabase config.
- **The device's cache** — a copy of the page, so it opens without a network.
