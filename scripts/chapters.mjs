// Chapter counts, fetched from somewhere MangaUpdates will actually answer.
//
// The notify Worker can't do this itself: MangaUpdates sits behind Cloudflare
// bot protection and returns 403 to Worker egress, and 403 to browsers too (an
// Origin header alone is enough). A GitHub Actions runner is neither, so it gets
// a normal response — which makes this script the only place the lookup works.
//
// It writes data/chapters.json into the repo. Pages serves that, and both the
// app and the Worker read it from there. No secrets travel anywhere: the only
// thing published is a chapter number per series.
import fs from 'node:fs/promises';

const MU = 'https://api.mangaupdates.com/v1';
const OUT = 'data/chapters.json';
const UA = 'WatchList/1.0 (+https://theteknojunkie456.github.io/anime-list/)';

const NOTIFY = process.env.NOTIFY_URL || 'https://watchlist-notify.muhammad-dac.workers.dev';
const TOKEN = process.env.ADMIN_TOKEN || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Does this candidate actually look like the series we asked for? */
function looksRight(candidate, names) {
  const c = flat(candidate);
  if (!c) return false;
  for (const n of names) {
    const f = flat(n);
    if (!f || f.length < 4) continue;
    if (c === f) return true;
    if (c.length >= 6 && f.length >= 6 && (c.includes(f) || f.includes(c))) return true;
  }
  return false;
}

async function muSearch(names) {
  for (const name of names) {
    let matches = [];
    try {
      const r = await fetch(MU + '/series/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ search: String(name).slice(0, 120), perpage: 5 }),
      });
      if (!r.ok) { console.log(`  search "${name}" -> HTTP ${r.status}`); continue; }
      const d = await r.json();
      for (const res of d.results || []) {
        const rec = res.record;
        if (rec && rec.series_id && looksRight(rec.title, names)) {
          matches.push({ id: rec.series_id, title: rec.title, type: rec.type || '' });
        }
      }
    } catch (e) { console.log(`  search "${name}" failed: ${e.message}`); }

    if (matches.length) {
      // A web novel and its comic adaptation are separate entries with almost the
      // same name, and the novel usually carries no chapter count — so matching
      // it means silence. Prefer the comic; fall back to the novel only if that
      // is genuinely all there is.
      const isNovel = (m) => /novel/i.test(m.type) || /\(\s*novel\s*\)/i.test(m.title);
      const comic = matches.find((m) => !isNovel(m));
      return comic || matches[0];
    }
    await sleep(1200);
  }
  return null;
}

async function muLatest(seriesId) {
  try {
    const r = await fetch(`${MU}/series/${seriesId}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const d = await r.json();
    const n = Number(d.latest_chapter);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Associated names answer "what else is this called" — the reader usually
    // uses one of these rather than the title everyone else uses.
    const assoc = (d.associated || []).map((a) => a && a.title).filter(Boolean);
    return { chapter: n, title: d.title || '', type: d.type || '', assoc };
  } catch { return null; }
}

/**
 * Dated releases for one series — what makes a reading calendar possible.
 *
 * The releases endpoint ignores `series_id` (it answers the global feed no
 * matter what you pass), and `orderby` silently overrides the query too. What
 * it does honour is `search`. So ask by name and keep only the rows that are
 * really this series: fuzzy search plus a strict alias check is what stops
 * "Lore Olympus" picking up "Olimpos" the way the title matcher once did.
 */
function chapterNum(raw) {
  // "1-2" means a double release; the chapter reached is the last number.
  const nums = String(raw || '').match(/\d+(?:\.\d+)?/g);
  return nums && nums.length ? Number(nums[nums.length - 1]) : null;
}

async function muReleases(names) {
  const seen = new Map();                       // chapter -> earliest date seen
  for (const name of names.slice(0, 4)) {
    try {
      const r = await fetch(MU + '/releases/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ search: String(name).slice(0, 120), perpage: 50 }),
      });
      if (r.ok) {
        const d = await r.json();
        for (const row of d.results || []) {
          const rec = (row && row.record) || row;
          if (!rec || !rec.release_date) continue;
          if (!looksRight(rec.title, names)) continue;
          const ch = chapterNum(rec.chapter);
          if (ch == null) continue;
          const prev = seen.get(ch);
          // Several groups can list the same chapter; the first one out is the
          // date a reader actually got it.
          if (!prev || rec.release_date < prev) seen.set(ch, rec.release_date);
        }
      }
    } catch (e) { console.log(`  releases "${name}" failed: ${e.message}`); }
    await sleep(1200);
    if (seen.size >= 10) break;                 // enough to read a rhythm from
  }
  if (!seen.size) return null;

  const list = [...seen.entries()]
    .map(([ch, date]) => ({ ch, date }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ch - b.ch));

  // Rate, not gap. A median gap is measured between the rows we happened to
  // catch, so one missed release reads a weekly series as biweekly — which is
  // exactly what it did to The Stellar Swordmaster (15 of 16 releases on a
  // Wednesday, called 14-day). Chapters per day is immune to holes: six
  // chapters across six weeks is weekly whether or not all six were seen.
  // Measured over the recent window, so an old hiatus doesn't drag it either.
  const dayOf = (r) => new Date(r.date + 'T12:00:00').getDay();

  // Two groups translating the same series keep two different chapter numbers on
  // two different days, and merging them is nonsense: The Extra's Academy
  // Survival Guide has a Monday source around ch 94-98 and a Thursday source
  // around ch 106-116, which together read as a 3-day cadence. Neither is a
  // majority, so "most rows wins" doesn't separate them either — but whichever
  // posted LAST is the one still running, and that's the one a reader is on.
  const liveDay = dayOf(list[list.length - 1]);
  const stream = list.filter((r) => dayOf(r) === liveDay);
  const weekday = stream.length >= 3 ? liveDay : null;

  // Median of per-pair rates, not first-to-last: a hole in the harvest spans
  // several chapters at once, and averaging across it drags a weekly series
  // toward biweekly. Each pair carries its own chapters-per-day, and the median
  // ignores the pairs that straddle a gap.
  const recent = (weekday == null ? list : stream).slice(-9);
  let cadence = null;
  const rates = [];
  for (let i = 1; i < recent.length; i++) {
    const days = (Date.parse(recent[i].date) - Date.parse(recent[i - 1].date)) / 864e5;
    const chs = recent[i].ch - recent[i - 1].ch;
    if (days > 0 && chs > 0) rates.push(days / chs);
  }
  if (rates.length >= 2) {
    rates.sort((a, b) => a - b);
    const med = rates[Math.floor(rates.length / 2)];
    if (med >= 0.5 && med <= 60) cadence = Math.round(med);
  }

  return { list: list.slice(-16), cadence, weekday };
}

async function trackedSeries() {
  if (!TOKEN) {
    console.log('No ADMIN_TOKEN set — refreshing only the series already in the file.');
    return null;
  }
  const r = await fetch(NOTIFY + '/manga-tracked', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  });
  if (!r.ok) throw new Error('manga-tracked HTTP ' + r.status);
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'manga-tracked refused');
  return d.series || [];
}

/**
 * Readers that stamp every series URL with the same rotating code — AsuraScans
 * puts /comics/<name>-<code> on all of them — silently break every deep link the
 * day they rotate it. The app shipped 1d35e5bd hardcoded; the site is on
 * 00dcbf97 now, which is exactly why some series 404 and others redirect.
 *
 * A runner can read the site, so the current code is scraped here and published
 * with the chapter data. The app reads it instead of its own stale constant.
 */
/**
 * What does the READER call this series? Nothing can derive it — AsuraScans
 * calls "The Patron of Villains" raising-villains-the-right-way — but every
 * alias is published somewhere: AniList synonyms and MangaUpdates associated
 * names. Try each as a slug and keep the one the site actually serves.
 */
// Readers this resolves for. Adding one is a line: its host, the path series
// live under, and whether it stamps a rotating code onto every slug.
const READERS = [
  { host: 'asurascans.com', path: 'comics', code: true },
  { host: 'reaperscans.com', path: 'series', code: false },
  { host: 'flamecomics.xyz', path: 'series', code: false },
];

// Readers people actually use, discovered rather than hardcoded.
//
// The three above are the ones this script was written around, which means a
// series that lives anywhere else is invisible to it — and the shared-source
// list already knows where people read, because they configured it. Those hosts
// are polled too, so "the latest chapter" stops meaning "the latest chapter on
// one of three sites I happened to pick".
//
// A discovered host doesn't announce its URL shape, so a small set of common
// ones is tried. resolveReaderSlug() already treats a miss as a miss and
// remembers it for a week, so a wrong guess costs a handful of requests once,
// not every run.
const READER_PATHS = ['series', 'comics', 'manga', 'manhwa', 'read', 'title'];
// Watch sites in the shared list would be probed pointlessly, so only hosts that
// look like readers are taken. Cheap heuristic, and a wrong guess is self-
// correcting: nothing resolves, it's recorded as a miss, and it stops being
// asked. Better than skipping a genuine reader because it isn't on a list.
function looksLikeReader(h) {
  return /(scan|comic|manga|manhwa|manhua|toon|read|novel)/i.test(h);
}
async function discoveredReaders(hosts) {
  const known = new Set(READERS.map((r) => r.host));
  const out = [];
  for (const h of [...new Set(hosts)]) {
    if (known.has(h) || !looksLikeReader(h)) continue;
    for (const path of READER_PATHS) out.push({ host: h, path, code: false, discovered: true });
  }
  return out;
}

async function resolveReaderSlug(reader, code, names) {
  const tried = new Set();
  for (const n of names) {
    const slug = String(n).toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug || slug.length < 4 || tried.has(slug)) continue;
    tried.add(slug);
    const suffix = reader.code && code ? '-' + code : '';
    const url = `https://${reader.host}/${reader.path}/${slug}${suffix}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
      if (r.status === 200) { console.log(`    ${reader.host}: ${slug}`); return slug; }
    } catch {}
    await sleep(700);
  }
  return null;
}

/**
 * What the READER itself says — the source of truth for what the app links to.
 *
 * MangaUpdates' release feed indexes one scanlation stream and lags badly (it
 * had The Patron of Villains at ch 32 while Asura was serving 46), so anchoring
 * a projection on it drifts. The reader's own chapter list doesn't lag: it IS
 * what the user opens.
 *
 * Dates there are relative ("4 days ago", "last week"), so only the newest row
 * is precise — but that's the one that matters, because it's the anchor every
 * future chapter is projected from.
 */
function agoToDate(txt) {
  const t = String(txt || '').toLowerCase().trim();
  const now = Date.now();
  if (/^today$/.test(t)) return new Date(now);
  if (/^yesterday$/.test(t)) return new Date(now - 864e5);
  if (/^last week$/.test(t)) return new Date(now - 7 * 864e5);
  const m = t.match(/^(\d+)\s*(hour|day|week|month|year)s?\s*ago$/);
  if (!m) return null;
  const n = Number(m[1]);
  const per = { hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[m[2]];
  return new Date(now - n * per * 864e5);
}

async function readerLatest(reader, code, slug) {
  const suffix = reader.code && code ? '-' + code : '';
  const url = `https://${reader.host}/${reader.path}/${slug}${suffix}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const html = await r.text();
    // Strip tags to plain text; the list renders as "Chapter 46" then "4 days ago"
    // with markup between, so match across the gap rather than guessing at DOM.
    const txt = html.replace(/<[^>]+>/g, '|');
    const rows = [];
    const re = /Chapter \|+(\d+(?:\.\d+)?)\|+((?:\d+\s*(?:hour|day|week|month|year)s?\s*ago|last week|yesterday|today))/gi;
    for (const m of txt.matchAll(re)) {
      const d = agoToDate(m[2]);
      if (d) rows.push({ ch: Number(m[1]), at: d });
    }
    if (!rows.length) return null;
    rows.sort((a, b) => b.ch - a.ch);
    const top = rows[0];
    return { chapter: top.ch, at: top.at.toISOString().slice(0, 10), rows: rows.length };
  } catch (e) { return null; }
}

/**
 * Can a browser put this host in an iframe?
 *
 * The app cannot answer this itself. Cross-origin isolation means a page is
 * never told whether its frame was blocked — github.com (X-Frame-Options:
 * DENY) is indistinguishable from a page that loaded fine, whichever way you
 * poke at it. But the headers say so plainly, and a runner can read them.
 *
 * Caveat worth keeping honest: a host behind a bot challenge answers with the
 * CHALLENGE page's headers, not its own. Cloudflare's challenge sets SAMEORIGIN
 * regardless of what the site would send, so that case is reported separately
 * rather than being called a refusal — it is genuinely unknown from here.
 */
async function hostFrames(host) {
  try {
    const r = await fetch(`https://${host}/`, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    const xfo = (r.headers.get('x-frame-options') || '').toLowerCase().trim();
    const csp = (r.headers.get('content-security-policy') || '').toLowerCase();
    const fa = (csp.match(/frame-ancestors([^;]*)/) || [])[1] || '';
    const challenged = !!r.headers.get('cf-mitigated') || r.status === 403;
    let verdict = 'ok';
    if (xfo === 'deny' || xfo === 'sameorigin' || /'none'|'self'/.test(fa)) verdict = 'blocked';
    if (challenged) verdict = 'unknown';         // headers belong to the challenge, not the site
    return { frames: verdict, xfo: xfo || null, challenged, at: new Date().toISOString() };
  } catch (e) { return null; }
}

async function readerSuffix(host) {
  try {
    const r = await fetch(`https://${host}/`, { headers: { 'User-Agent': UA } });
    if (!r.ok) { console.log(`  ${host} -> HTTP ${r.status}`); return null; }
    const html = await r.text();
    const counts = new Map();
    for (const m of html.matchAll(/\/comics\/[a-z0-9-]+?-([0-9a-f]{6,10})(?=["'\/?#])/gi)) {
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    if (!counts.size) return null;
    // The one nearly every link carries is the site-wide code; anything else is
    // a leftover on an old entry.
    const [code, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n < 5) { console.log(`  ${host}: no confident code (best ${code} x${n})`); return null; }
    console.log(`  ${host}: code ${code} (on ${n} links)`);
    return code;
  } catch (e) { console.log(`  ${host} failed: ${e.message}`); return null; }
}

const prev = await fs.readFile(OUT, 'utf8').then(JSON.parse).catch(() => ({ series: {} }));

/**
 * Should this run do any work?
 *
 * The workflow now fires hourly, but hammering MangaUpdates and the readers 24
 * times a day is both rude and a good way to get rate-limited — and pointless,
 * since a weekly series moves on one known day. So: hourly ON the days a
 * tracked series actually releases, and the old every-6-hours floor otherwise.
 *
 * The days aren't hardcoded. Each series carries the weekday it posts on, so
 * this follows the data — a series that moves to Sundays is picked up on the
 * next full run with no edit here.
 */
function shouldRun(prevData) {
  const series = Object.values(prevData.series || {});
  if (!series.length) return true;                       // nothing known yet
  const today = new Date().getDay();
  // Yesterday counts too: a chapter posted late in the day lands on the next
  // date in UTC, and the runner is UTC.
  const yesterday = (today + 6) % 7;
  const due = series.some((s) => s.weekday === today || s.weekday === yesterday);
  if (due) return true;
  const last = Date.parse(prevData.updatedAt || 0) || 0;
  return Date.now() - last > 6 * 3600e3;
}

// A hand-triggered run is someone asking for it NOW — skipping would make the
// workflow_dispatch button do nothing, which is the opposite of what it's for.
const FORCE = process.env.FORCE === '1' || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
if (!FORCE && !shouldRun(prev)) {
  console.log('Nothing releases today and the file is fresh — skipping this run.');
  process.exit(0);                                       // no write, so no commit
}

const out = { updatedAt: new Date().toISOString(), series: { ...(prev.series || {}) } };

let tracked = null;
try { tracked = await trackedSeries(); }
catch (e) { console.log('Couldn\'t read the tracked list: ' + e.message); }

// Anything already known stays refreshed even if the tracked list is unavailable,
// so a bad token degrades to "no new series" rather than losing every count.
const work = new Map();
for (const [aniId, rec] of Object.entries(out.series)) work.set(Number(aniId), rec.names || [rec.title].filter(Boolean));
for (const s of tracked || []) if (s && s.aniId) work.set(Number(s.aniId), (s.names || []).filter(Boolean));

// Reader codes FIRST — the per-series slug test builds a URL with today's code.
// Per-reader codes, refreshed every run so a rotation is picked up within hours.
out.readers = { ...(prev.readers || {}) };
for (const reader of READERS.filter((r) => r.code)) {
  const code = await readerSuffix(reader.host);
  if (code) out.readers[reader.host] = { suffix: code, at: new Date().toISOString() };
  await sleep(1000);
}

// Framing verdicts for the hosts the app can send you to. Cheap (one request
// each) and the list is short, so it refreshes every run — a site that changes
// its policy is picked up the same day.
out.frames = { ...(prev.frames || {}) };

// The built-ins, plus whatever people are actually using. Measuring only the
// presets meant a custom source — the kind most likely to be an unknown
// quantity — was never checked at all, so the app had no verdict for the one
// host it mattered most for.
//
// POST, and the list is nested under `sources`: a GET answers 405, which would
// have made this whole thing fail silently and measure nothing.
async function sharedHosts() {
  try {
    const r = await fetch(NOTIFY + '/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: '{}',
    });
    if (!r.ok) { console.log(`  shared sources -> HTTP ${r.status}`); return []; }
    const d = await r.json();
    const list = (d.sources && d.sources.list) || d.list || [];
    return list
      .map((x) => {
        // Source URLs are templates ({slug}, {ep}) — neutralise the placeholders
        // before parsing or the URL constructor throws on every one of them.
        try { return new URL(String(x.url || x).replace(/\{[^}]+\}/g, 'x')).hostname; }
        catch { return ''; }
      })
      .filter(Boolean);
  } catch (e) { console.log(`  shared sources failed: ${e.message}`); return []; }
}

const SHARED_HOSTS = await sharedHosts();
// Probed for chapters alongside the built-in three. Deduped by host+path so a
// site listed twice isn't asked twice.
const EXTRA_READERS = await discoveredReaders(SHARED_HOSTS);
if (EXTRA_READERS.length) {
  console.log(`  discovered readers: ${[...new Set(EXTRA_READERS.map((r) => r.host))].join(', ')}`);
  READERS.push(...EXTRA_READERS);
}
const FRAME_HOSTS = [
  ...READERS.map((r) => r.host),
  'miruro.tv', 'pluto.tv', 'therokuchannel.roku.com', 'www.peacocktv.com',
  'www.retrocrush.tv', 'watch.plex.tv', 'anineko.to',
  ...SHARED_HOSTS,
];
for (const h of [...new Set(FRAME_HOSTS)]) {
  const v = await hostFrames(h);
  if (!v) continue;
  const was = out.frames[h] || {};

  // Whether a host answers with a bot challenge varies run to run, so the raw
  // reading flaps: reaperscans measured 'blocked' one run and 'unknown' the
  // next, purely on whether the runner got challenged. Two rules stop that
  // turning into a working source going dark.
  //
  // 1. A challenged reading tells us nothing about the SITE, so it must never
  //    overwrite a real measurement. Keep what we knew.
  if (v.challenged && was.frames && was.frames !== 'unknown') {
    console.log(`  frames ${h}: challenged, keeping ${was.frames}`);
    await sleep(500);
    continue;
  }

  // 2. 'blocked' is the only verdict that stops the app from even trying, so it
  //    has to earn it twice in a row. One flaky read shouldn't silently retire a
  //    source that works.
  if (v.frames === 'blocked') {
    // The streak has to be tracked separately from the verdict we PUBLISH.
    // Strike one publishes 'unknown' (keep trying), so keying the count off the
    // published value reset it every run and 'blocked' could never be confirmed.
    const priorStreak = (was.pending === 'blocked' || was.frames === 'blocked') ? (was.strikes || 1) : 0;
    const strikes = priorStreak + 1;
    if (strikes < 2) {
      out.frames[h] = { ...v, frames: was.frames === 'ok' ? 'ok' : 'unknown', strikes, pending: 'blocked' };
      console.log(`  frames ${h}: blocked (strike ${strikes}/2 — still trying)`);
      await sleep(500);
      continue;
    }
    out.frames[h] = { ...v, strikes };
    console.log(`  frames ${h}: blocked (confirmed)`);
    await sleep(500);
    continue;
  }

  out.frames[h] = v;                              // ok / unknown, measured cleanly
  console.log(`  frames ${h}: ${v.frames}${v.xfo ? ` (${v.xfo})` : ''}`);
  await sleep(500);
}

console.log(`${work.size} series to check`);
let changed = 0, missing = 0;

for (const [aniId, names] of work) {
  const known = out.series[aniId] || {};
  let muId = known.muId;
  if (!muId && names.length) {
    const hit = await muSearch(names);
    if (hit) { muId = hit.id; console.log(`  matched ${names[0]} -> ${hit.title} (${hit.id})`); }
    else { missing++; console.log(`  no match: ${names[0] || aniId}`); }
    await sleep(1200);
  }
  if (!muId) { out.series[aniId] = { ...known, names, muId: null }; continue; }
  const latest = await muLatest(muId);
  await sleep(1200);
  if (!latest) { out.series[aniId] = { ...known, names, muId }; continue; }
  if (known.chapter !== latest.chapter) changed++;
  // Keep every name this series is known by — AniList's, MangaUpdates' own, and
  // whatever the user typed. The app looks a series up by title when it has no
  // AniList id yet, so an alias is the difference between a chapter list and a
  // blank space.
  const allNames = [...new Set([...(known.names || []), ...names, latest.title, ...(latest.assoc || [])].filter(Boolean))];
  out.series[aniId] = { names: allNames, muId, chapter: latest.chapter, title: latest.title, type: latest.type };

  // Dated releases, so reading can sit on the calendar next to airing anime.
  // Kept even when a run comes back empty — a search hiccup shouldn't wipe the
  // history the calendar draws from.
  const rel = await muReleases(allNames);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (rel && rel.list.length) {
    out.series[aniId].releases = rel.list;
    if (rel.cadence) out.series[aniId].cadence = rel.cadence;
    if (rel.weekday != null) out.series[aniId].weekday = rel.weekday;
    console.log(`    ${rel.list.length} dated releases${rel.cadence ? `, ~every ${rel.cadence}d` : ''}${rel.weekday != null ? ` on ${DAYS[rel.weekday]}` : ''}`);
  } else if (known.releases) {
    out.series[aniId].releases = known.releases;
    if (known.cadence) out.series[aniId].cadence = known.cadence;
    if (known.weekday != null) out.series[aniId].weekday = known.weekday;
  }

  // What does the READER call it? Nothing can derive that — AsuraScans calls
  // "The Patron of Villains" raising-villains-the-right-way — but every alias is
  // published somewhere, and now they're all in allNames. Try each as a slug and
  // keep the one the site actually serves. Done once, then remembered.
  const slugs = { ...(known.readSlug || {}) };
  const probed = { ...(known.readTried || {}) };
  const WEEK = 7 * 864e5;
  for (const reader of READERS) {
    // A discovered host appears once per candidate path. The moment any of them
    // resolves, the host is solved and the remaining paths are dead weight.
    if (reader.discovered && slugs[reader.host]) continue;
    if (slugs[reader.host]) continue;                       // known, and never re-probed
    // A miss is remembered too, or a series that simply isn't on this reader
    // costs a handful of requests every single run, forever. Retried weekly in
    // case it gets added later.
    if (probed[reader.host] && Date.now() - probed[reader.host] < WEEK) continue;
    const code = (out.readers[reader.host] || {}).suffix || null;
    const slug = await resolveReaderSlug(reader, code, allNames);
    if (slug) {
      slugs[reader.host] = slug;
      // The path that answered is part of the address; without it the read step
      // would rebuild the URL from the first candidate path and 404.
      (out.series[aniId].readPath = out.series[aniId].readPath || {})[reader.host] = reader.path;
    } else probed[reader.host] = Date.now();
  }
  if (Object.keys(slugs).length) out.series[aniId].readSlug = slugs;
  if (Object.keys(probed).length) out.series[aniId].readTried = probed;

  // Ask the reader itself where the series is up to. Its chapter number is the
  // one the app deep-links to, and its newest timestamp is a better projection
  // anchor than the release feed's last row, which can be dozens behind.
  // Every reader that answers, not just the first. Readers disagree — one may be
  // twenty chapters ahead of another — and the count someone should see is the
  // count on the site THEY read from, not whichever host happened to reply
  // first. Keeping them all is what lets the app pick per user.
  const readBy = { ...(known.readBy || {}) };
  const readSeen = new Set();
  for (const reader of READERS) {
    const slug = slugs[reader.host];
    if (!slug || readSeen.has(reader.host)) continue;
    readSeen.add(reader.host);
    const savedPath = ((known.readPath || {})[reader.host]) || ((out.series[aniId].readPath || {})[reader.host]);
    if (savedPath && savedPath !== reader.path) { readSeen.delete(reader.host); continue; }
    const code = (out.readers[reader.host] || {}).suffix || null;
    const live = await readerLatest(reader, code, slug);
    await sleep(800);
    if (!live) continue;
    readBy[reader.host] = { chapter: live.chapter, at: live.at };
    console.log(`    ${reader.host}: ch ${live.chapter}, last ${live.at}`);
  }
  if (Object.keys(readBy).length) {
    out.series[aniId].readBy = readBy;
    // Keep the flat fields too: they're what the notify worker and the calendar
    // anchor read, and the highest count across readers is the right answer for
    // "is there a new chapter anywhere".
    let best = null;
    for (const [host, v] of Object.entries(readBy)) {
      if (!best || v.chapter > best.v.chapter) best = { host, v };
    }
    out.series[aniId].readChapter = best.v.chapter;
    out.series[aniId].readAt = best.v.at;
    out.series[aniId].readHost = best.host;
  }
}

await fs.mkdir('data', { recursive: true });
await fs.writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${OUT}: ${Object.keys(out.series).length} series, ${changed} changed, ${missing} unmatched`);
