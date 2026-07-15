# Friends — sharing your Watchlist

`friends.html` is the **social companion** to the main Watchlist app. It lets you
**view a friend's list** (read-only) and **import titles** from it into your own,
using the same private cloud-sync system the main app already uses.

There are no accounts, no servers storing who-follows-whom, and nothing public —
sharing is done entirely with **secret sync codes**.

---

## How sharing works (in one picture)

```
Your Watchlist (index.html)                Friend's Watchlist
        │                                          │
        │  cloud sync (your secret code)           │
        ▼                                          ▼
   ┌─────────────────────  Cloudflare Worker + KV  ─────────────────────┐
   │  one private list stored per sync code — never listed, never public │
   └─────────────────────────────────────────────────────────────────────┘
        ▲                                          ▲
        │  paste a friend's code → pull (read-only) │
        │                                          │
     friends.html  ◄───────────  you view / import their list
```

Your list lives in **your browser** (localStorage) and, if you turn on sync, a
copy is stored in the cloud **under a long random secret code** (20 characters).
The worker only ever returns a list to someone who already **knows that exact
code** — it never enumerates codes and never exposes anyone else's data.

---

## Share *your* list with a friend

1. Open the main app → **backup / sync** sheet.
2. Turn on **Cloud sync** — this generates your **sync code** and pushes your
   current list to the cloud (it re-pushes automatically whenever you make
   changes).
3. **Send that code** to your friend (text, DM, whatever). Anyone with the code
   can view your list; anyone without it cannot. Treat it like a password —
   don't post it publicly.

> Tip: your code is your key. If you ever want to "unshare," you can rotate to a
> new code in the sync sheet; the old code then points at stale data you stop
> updating.

## View a *friend's* list

1. Open **`friends.html`** (e.g. `https://<your-pages-url>/friends.html`).
2. **Paste your friend's sync code** and load it.
3. Their list appears **read-only** — browse what they're watching, planning,
   and have finished, sorted/filtered like the main app.
4. **Import** any titles you like into your own list (they're copied into your
   Watchlist; your friend's list is never modified).

`friends.html` keeps its own separate local storage (`animelist_friends_v4`), so
viewing a friend's list never touches or overwrites your personal Watchlist.

---

## Privacy model

- **Your list is not public.** The GitHub repo is public (that's just the app's
  *code*), but your titles are **not** in it — your list lives only in your
  browser and, if you enable sync, in the private cloud store behind your secret
  code.
- **Access = knowing the code.** The sync worker returns a list only for an exact
  20-character code. It cannot list codes, browse lists, or leak one user's data
  to another.
- **Read-only for friends.** Viewing a friend's list can never edit it — imports
  copy into *your* list only.
- **Revocable.** Rotate your sync code to stop sharing the live version.
- **Password-protected lists.** If you set a password on your list (main app → backup panel), the cloud copy is **encrypted**. A friend then needs *both* your sync code **and** the password to view it — `friends.html` will prompt for the password on load. Without it, the list can't be read.

---

## Technical notes

- **Backend:** a single Cloudflare Worker (`cloud/sync-worker.js`) backed by a KV
  namespace. It supports two operations — `push` (store your list under your
  code) and `pull` (fetch the list for a code). That's the whole API.
- **Codes:** 20 random chars from an unambiguous alphabet
  (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), generated client-side. The space is large
  enough that codes are unguessable.
- **Storage keys:** the main app uses `animelist_v4`; the friends viewer uses
  `animelist_friends_v4` so the two never collide.
- **Offline:** both pages are PWAs (service-worker cached), so they load offline;
  sharing/importing needs a connection since it talks to the worker.
- **Deploy:** the static pages deploy via GitHub Actions → Pages on push to
  `main`; the sync worker is deployed separately to Cloudflare (see the main
  README's cloud-sync section).
