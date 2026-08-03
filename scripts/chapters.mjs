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
    return Number.isFinite(n) && n > 0 ? { chapter: n, title: d.title || '', type: d.type || '' } : null;
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
  const allNames = [...new Set([...(known.names || []), ...names, latest.title].filter(Boolean))];
  out.series[aniId] = { names: allNames, muId, chapter: latest.chapter, title: latest.title, type: latest.type };
}

await fs.mkdir('data', { recursive: true });
await fs.writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${OUT}: ${Object.keys(out.series).length} series, ${changed} changed, ${missing} unmatched`);
