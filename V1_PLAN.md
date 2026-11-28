# WatchList v1: the finished version

Written 2026-11-28. Goal from the family plan: "Finish a version — produce something other people can use", then test it with real users, collect feedback, improve it.

## What v1 is (one sentence)

A free app that keeps track of every anime, show and manga you're watching or reading, tells you when new episodes air, and syncs across your devices, with no account.

## In v1 (already built, just needs polish)

- Watch list and Read list, with statuses (Plan / Watching / Done / Dropped)
- Autofill with real cover art (AniList, TVMaze, Open Library)
- Airing times, weekly schedule, episode notifications
- For You recommendations
- Import from AniList, MyAnimeList or a pasted list
- Sync code across devices, password lock, recovery key
- Themes
- Friends viewer (share your list)
- "Where to watch": links that open the show on official services (Crunchyroll, Netflix, Hulu and so on)

## Not in v1 (cut, not deleted; some can come back after launch)

- The in-app player and "Read now" (unofficial streaming and scan sites), and custom streaming sources
- Watch parties and screen share (they stay in the private/official app)
- AI chat
- Any new feature. Feature freeze starts now: only fixes and polish until launch.

## Must fix before launch

1. **Sync reliability.** The free Cloudflare KV quota (1,000 writes a day) is used up, so syncing fails. Move sync storage to D1 or a Durable Object, or cut writes to under the free limit. Testers will notice this first.
2. **First five minutes.** Install, tutorial, add the first show, turn on notifications. Make sure all of it works on a fresh iPhone and a fresh PC browser.
3. **README and store text** describing only what v1 does.

## Dates

| When | What |
|---|---|
| Nov 28 - Dec 5 | Plan only (SAT is Dec 5) |
| Dec 6 - Dec 20 | Fix sync, strip the cut features from the public build, polish first-run |
| Dec 21 | **v1 ships** (public link) |
| Dec 21 - Jan 18 | 4 weeks of testing with real users |
| Jan 18 - Jan 31 | Improve based on feedback, ship v1.1 |

## Testers

5-10 people who actually watch anime or read manga: friends, classmates, the debate or Model UN group. Not family (they're too nice). Ask each one personally and send them the link.

## Feedback (what to measure)

- After 1 week: did they open it again on their own? (the most important number)
- How many titles did they add?
- Three questions: What's confusing? What's missing? Would you tell a friend about it?
- Use the in-app feedback button (it already sends a screenshot and an email).

## Done means

v1.1 is live, at least 5 testers used it for 2+ weeks, and you can explain in one minute what you learned. That's the "Test it / Collect feedback / Improve it / Present it" part of the plan.
