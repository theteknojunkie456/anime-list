// DOES WATCH GO TO THE SHOW AND THE EPISODE, OR TO A SEARCH PAGE?
//
// AniList hands the app two exact things: externalLinks (this show's own page on
// each service) and streamingEpisodes (per-episode URLs the services publish
// themselves). Both were fetched, rendered once into the detail sheet, and
// dropped — while Watch built a search URL out of the title. So pressing Watch
// on episode 12 opened a search results page for a show whose episode 12 URL
// the app was holding at the time.
import { readFileSync } from 'node:fs';
const h = readFileSync('index.html', 'utf8');
const grab = re => { const m = re.exec(h); if (!m) throw new Error('could not find ' + re); return m[0]; };
const src = [
  grab(/function rememberOfficialLinks\(a,d\)\{[\s\S]*?\n\}/),
  grab(/function officialWatch\(a,ep\)\{[\s\S]*?\n\}/),
].join('\n');
const ctx = { srcHost: u => { try { return new URL(u).hostname; } catch { return ''; } },
              effectiveSource: a => (a && a.srcUrl) || 'https://www.crunchyroll.com/search?q={title}' };
const { rememberOfficialLinks, officialWatch } =
  new Function('srcHost', 'effectiveSource', src + '; return {rememberOfficialLinks, officialWatch};')(ctx.srcHost, ctx.effectiveSource);

const d = {
  externalLinks: [
    { site: 'Crunchyroll', type: 'STREAMING', url: 'https://www.crunchyroll.com/series/GABC123/love-unseen' },
    { site: 'Netflix',     type: 'STREAMING', url: 'https://www.netflix.com/title/81234567' },
    { site: 'Twitter',     type: 'SOCIAL',    url: 'https://twitter.com/whatever' },
  ],
  streamingEpisodes: [
    { title: 'Episode 1 - The First Night',  url: 'https://www.crunchyroll.com/watch/E1/first-night' },
    { title: 'Episode 12 - Beneath the Sky', url: 'https://www.crunchyroll.com/watch/E12/beneath-the-sky' },
  ],
};
let pass = 0, fail = 0;
const check = (name, got, want) => { const o = got === want; o ? pass++ : fail++;
  console.log((o ? 'ok  ' : 'FAIL') + '  ' + name + '  -> ' + JSON.stringify(got) + (o ? '' : ' (want ' + JSON.stringify(want) + ')')); };

const a = { id: 'lu', title: 'Love Unseen Beneath the Night Sky', aniId: 999 };
check('the links are worth storing', rememberOfficialLinks(a, d), true);
check('episode 12 resolves to episode 12, not a search',
  (officialWatch(a, 12) || {}).url, 'https://www.crunchyroll.com/watch/E12/beneath-the-sky');
check('and it counts as addressing that episode', (officialWatch(a, 12) || {}).exact, true);
check('episode 1 resolves to episode 1',
  (officialWatch(a, 1) || {}).url, 'https://www.crunchyroll.com/watch/E1/first-night');
check('an episode with no published URL falls back to the show page on the chosen service',
  (officialWatch(a, 7) || {}).url, 'https://www.crunchyroll.com/series/GABC123/love-unseen');
check('that fallback does NOT claim to be the episode', (officialWatch(a, 7) || {}).exact, false);
check('a non-streaming link is never offered as somewhere to watch',
  Object.keys(a.svc).includes('twitter.com'), false);
check('the service the user chose wins over the others',
  (officialWatch({ ...a, svc: a.svc, srcUrl: 'https://www.netflix.com/search?q={title}' }, 7) || {}).url,
  'https://www.netflix.com/title/81234567');
check('a show we know nothing about asks for no link', officialWatch({ id: 'x', title: 'Unknown' }, 3), null);
check('re-storing identical data reports no change', rememberOfficialLinks(a, d), false);

// ── the background pass that fills the whole library ───────────────────────
// Two things here have bitten this app before. A needy-list predicate that
// never stops being true is how the cover fetcher ended up saving every two
// seconds for days, so the stamp has to go on whether or not AniList had
// anything to give. And the query has to survive an id AniList does not carry:
// an aliased batch fails whole ("Not Found") where Page(id_in:) just omits it.
const body = h.slice(h.indexOf('async function fetchWatchLinks'), h.indexOf('async function fetchWatchLinks') + 1800);
const needy = /function linksNeedy\(\)\{[\s\S]*?\n\}/.exec(h)[0];
const linksNeedy = new Function('anime', 'kindOf',
  needy.replace('function linksNeedy()', 'return (function linksNeedy()') + ')();');
const kindOf = a => (a && a.kind) === 'read' ? 'read' : 'watch';

check('a show with links already stored is not asked about again',
  linksNeedy([{ id: '1', aniId: 5, svcTried: 1 }], kindOf).length, 0);
check('a show AniList had nothing for is still not asked again',
  linksNeedy([{ id: '1', aniId: 5, svcTried: 1 }], kindOf).length, 0);
check('a show never asked about is picked up',
  linksNeedy([{ id: '1', aniId: 5 }], kindOf).length, 1);
check('a title with no AniList id is skipped, not queried with a blank',
  linksNeedy([{ id: '1' }], kindOf).length, 0);
check('reading titles are left out — this is where to WATCH',
  linksNeedy([{ id: '1', aniId: 5, kind: 'read' }], kindOf).length, 0);
check('the pass stamps every title in the batch, hit or miss',
  /a\.svcTried=1;\s*changed=true;/.test(body), true);
check('it asks via Page(id_in:), which tolerates an id AniList lacks',
  /Page\(perPage:50\)\{media\(id_in:\$ids/.test(body), true);
check('it does not drag per-episode lists into a batch query',
  /streamingEpisodes/.test(body), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
