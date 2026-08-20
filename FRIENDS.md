# Friends — sharing your WatchList

`friends.html` is the **social companion** to the main WatchList app. It lets you
**view a friend's list** (read-only) and **import titles** from it into your own,
using the same private cloud-sync system the main app already uses.

There are no accounts, no servers storing who-follows-whom, and nothing public —
sharing is done entirely with **secret sync codes**.

---

## How sharing works (in one picture)

```
Your WatchList (index.html)                Friend's WatchList
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
   WatchList; your friend's list is never modified).

`friends.html` keeps its own separate local storage (`animelist_friends_v4`), so
viewing a friend's list never touches or overwrites your personal WatchList.

---

## From Friends

Everything recommendation-shaped lives in one place, and that place is **the list
itself** — not a panel over it. Pick **From Friends** in the sort/filter dropdown
and the list becomes the record:

- **To you** — every recommendation anyone has ever sent you, in two groups.
  *Waiting on you* are the ones still undecided, and they sort above everything
  else so a new one never lands underneath a year of history. *Already on your
  list* is the rest, and it stays there after you add it and after you finish it.
  Each row carries the cover, where it stands, the dates it passed through
  (recommended → added → started → finished/dropped), every friend who sent it
  with what they said, and your replies back. Add, turn down, open and reply all
  happen on the row.
- **You sent** — one row **per title**, not per envelope, carrying the same
  detail as the other tab from the other side. A send of seven shows used to be
  seven titles comma-joined into one grey line with a single button. Each row now
  shows the cover, a state pill, and the whole timeline: when you sent it, when
  they added it, started it, finished or dropped it, whether they turned it down
  and when, what it costs to watch, and which send it belonged to. Their replies
  are quoted under it, and **the note you attached when you sent it** is quoted
  above them — it is the first thing anyone said about that show, and this tab
  used to be the one place it never appeared. When there is nothing back yet, the
  row says which kind of nothing — not opened, opened but nothing said, or turned
  down. (Sends logged before the note was kept have nothing to show; only sends
  from here on carry it.) Taking back is
  still per envelope (that is what the server files), so a row from a multi-title
  send says *Take back all 7*.
- **The tabs stay put.** They are pinned to the top of the list, so scrolling
  nineteen rows of history no longer carries the only way back to the other half
  off the screen with it.
- **The badges count what is waiting**, never the lifetime total. A number that
  only ever grows is decoration, not a notification.
- **The kind switch still applies.** A manhwa someone sent belongs to the reading
  list; nothing is hidden silently, and the other pile is counted with a way
  across.

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
- **Turning down a recommendation is visible to the person who sent it** — and
  only to them. Hiding a card tells that friend you passed on that one show; it
  shows up as a line in their *You recommended* list, never as a notification.
  Nobody else can see it, and it says nothing about the rest of your list.
- **Password-protected lists.** If you set a password on your list (main app → Settings → Password), the cloud copy is **encrypted**. A friend then needs *both* your sync code **and** the password to view it — `friends.html` will prompt for the password on load. Without it, the list can't be read.

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
