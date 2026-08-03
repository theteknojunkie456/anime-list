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

  // What does the READER call it? Nothing can derive that — AsuraScans calls
  // "The Patron of Villains" raising-villains-the-right-way — but every alias is
  // published somewhere, and now they're all in allNames. Try each as a slug and
  // keep the one the site actually serves. Done once, then remembered.
  const slugs = { ...(known.readSlug || {}) };
  const probed = { ...(known.readTried || {}) };
  const WEEK = 7 * 864e5;
  for (const reader of READERS) {
    if (slugs[reader.host]) continue;                       // known, and never re-probed
    // A miss is remembered too, or a series that simply isn't on this reader
    // costs a handful of requests every single run, forever. Retried weekly in
    // case it gets added later.
    if (probed[reader.host] && Date.now() - probed[reader.host] < WEEK) continue;
    const code = (out.readers[reader.host] || {}).suffix || null;
    const slug = await resolveReaderSlug(reader, code, allNames);
    if (slug) slugs[reader.host] = slug; else probed[reader.host] = Date.now();
  }
  if (Object.keys(slugs).length) out.series[aniId].readSlug = slugs;
  if (Object.keys(probed).length) out.series[aniId].readTried = probed;
}

await fs.mkdir('data', { recursive: true });
await fs.writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${OUT}: ${Object.keys(out.series).length} series, ${changed} changed, ${missing} unmatched`);
