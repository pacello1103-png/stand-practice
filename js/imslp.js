// Find works on IMSLP and rank their PDFs. Uses IMSLP's public MediaWiki API through JSONP
// (it does not allow cross-site fetch), a built-in composer index, and Wikidata as a fallback.
const API = 'https://imslp.org/api.php';
let cbn = 0;

export function jsonp(params, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const name = '__imslp' + Date.now().toString(36) + (cbn++);
    const qs = new URLSearchParams({ ...params, format: 'json', callback: name });
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    function cleanup() { clearTimeout(t); delete window[name]; s.remove(); }
    window[name] = (data) => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error('network')); };
    s.src = API + '?' + qs.toString();
    document.head.append(s);
  });
}

export const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ł/g, 'l')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'for', 'and', 'by', 'no', 'nr', 'number', 'de', 'la', 'le', 'des', 'du', 'pour', 'et', 'und', 'fur', 'from', 'op', 'opus', 'with', 'major', 'minor', 'dur', 'moll', 'flat', 'sharp']);
const SYN = {
  suites: 'suite', sonatas: 'sonata', concertos: 'concerto', concerti: 'concerto', partitas: 'partita', etudes: 'etude', studies: 'etude', study: 'etude',
  preludes: 'prelude', variations: 'variation', violoncello: 'cello', cellos: 'cello', violoncelle: 'cello', vc: 'cello',
  swan: 'cygne', elegy: 'elegie', carnival: 'carnaval', animals: 'animaux', seasons: 'stagioni', nocturnes: 'nocturne', waltz: 'valse', waltzes: 'valse',
  symphonies: 'symphony', quartets: 'quartet', trios: 'trio', duets: 'duet', duos: 'duo', songs: 'song', lieder: 'lied', dances: 'dance', pieces: 'piece', pieces2: 'stucke',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  hungarian: 'hungarian', rococo: 'rococo', bwv: 'bwv',
};
const norm = (w) => SYN[w] || w;

let composers = null;
export async function loadComposers() {
  if (!composers) composers = await fetch(new URL('./composers.json', import.meta.url)).then((r) => r.json());
  return composers;
}

// Split a query into a composer (if recognised) and the remaining words.
export async function parseQuery(q) {
  const list = await loadComposers();
  const f = ' ' + fold(q) + ' ';
  let best = null, bestScore = -1, bestKey = '';
  for (const c of list) {
    for (const k of c.k) {
      if (!f.includes(' ' + k + ' ')) continue;
      let score = k.length / 10 + c.p * 2;
      for (const g of c.g) if (f.includes(' ' + g + ' ')) score += 3;
      if (score > bestScore) { bestScore = score; best = c; bestKey = k; }
    }
  }
  let rest = f;
  if (best) {
    rest = rest.replace(' ' + bestKey + ' ', ' ');
    for (const g of best.g) rest = rest.replace(' ' + g + ' ', ' ');
    rest = rest.replace(/ (j s|js|cpe|w a|wa) /g, ' ');
  }
  const words = rest.trim().split(/\s+/).filter(Boolean).map(norm);
  return { composer: best, words, keyWords: words.filter((w) => !STOP.has(w)) };
}

const worksCache = new Map();
export async function composerWorks(cat) {
  if (worksCache.has(cat)) return worksCache.get(cat);
  const out = [];
  let cont = null, guard = 0;
  do {
    const p = { action: 'query', list: 'categorymembers', cmtitle: 'Category:' + cat, cmnamespace: '0', cmlimit: '500' };
    if (cont) p.cmcontinue = cont;
    const d = await jsonp(p);
    for (const m of d.query.categorymembers) out.push(m.title);
    cont = d.continue && d.continue.cmcontinue;
  } while (cont && ++guard < 8);
  worksCache.set(cat, out);
  return out;
}

export function splitTitle(t) {
  const m = t.match(/^(.*) \(([^()]*)\)$/);
  if (!m) return { work: t, composer: '' };
  const [sur, given] = m[2].split(', ');
  return { work: m[1], composer: given ? given + ' ' + sur : sur };
}

// Score how well a work title matches the words the person typed (0..1).
function scoreTitle(title, words) {
  if (!words.length) return 0.5;
  const tw = fold(splitTitle(title).work).split(' ').map(norm);
  const tset = new Set(tw);
  let s = 0, n = 0;
  for (const w of words) {
    const weight = STOP.has(w) ? 0.35 : /^\d+$/.test(w) ? 1.2 : 1;
    n += weight;
    if (tset.has(w)) { s += weight; continue; }
    if (w.length >= 3 && tw.some((x) => x.startsWith(w) || (x.length >= 4 && w.startsWith(x)))) { s += weight * 0.75; continue; }
    if (w === 'cello' && tw.some((x) => x.includes('cell'))) { s += weight; continue; }
  }
  return s / n;
}

export async function searchWorks(q) {
  const pq = await parseQuery(q);
  let results = [];
  if (pq.composer) {
    const works = await composerWorks(pq.composer.c);
    if (!pq.words.length) {
      results = works.map((t) => ({ title: t, score: 0.5 }));
      results.sort((a, b) => a.title.localeCompare(b.title));
      return { composer: pq.composer, results, browse: true };
    }
    results = works.map((t) => ({ title: t, score: scoreTitle(t, pq.words) - fold(t).length / 2000 }))
      .filter((r) => r.score > 0.3).sort((a, b) => b.score - a.score).slice(0, 30);
  }
  if (!pq.composer || results.length === 0) {
    const extra = await nativeSearch(q).catch(() => []);
    const seen = new Set(results.map((r) => r.title));
    for (const t of extra) if (!seen.has(t)) { seen.add(t); results.push({ title: t, score: 0.2 }); }
  }
  if (results.length === 0) {
    const extra = await wikidataSearch(q).catch(() => []);
    const seen = new Set(results.map((r) => r.title));
    for (const t of extra) if (!seen.has(t)) { seen.add(t); results.push({ title: t, score: 0.15 }); }
  }
  return { composer: pq.composer, results, browse: false };
}

async function nativeSearch(q) {
  const d = await jsonp({ action: 'query', list: 'search', srsearch: q, srnamespace: '0', srlimit: '20' });
  const out = [];
  for (const r of (d.query && d.query.search) || []) {
    const m = r.snippet && r.snippet.match(/#REDIRECT \[\[([^\]]+)\]\]/i);
    const t = m ? m[1].replace(/<[^>]+>/g, '') : r.title;
    if (/\(.+\)$/.test(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

async function wikidataSearch(q) {
  const u = 'https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'query', list: 'search', srsearch: q + ' haswbstatement:P839', srlimit: '8', format: 'json', origin: '*' });
  const d = await fetch(u).then((r) => r.json());
  const ids = d.query.search.map((s) => s.title);
  if (!ids.length) return [];
  const u2 = 'https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims', format: 'json', origin: '*' });
  const e = await fetch(u2).then((r) => r.json());
  const out = [];
  for (const id of ids) {
    const c = e.entities[id] && e.entities[id].claims && e.entities[id].claims.P839;
    const v = c && c[0].mainsnak.datavalue && c[0].mainsnak.datavalue.value;
    if (v && !v.startsWith('Category:')) out.push(v.replace(/_/g, ' '));
  }
  return out;
}

// ---------- work page ----------
const TABS = { tabScore1: 'Full scores', tabScore2: 'Parts', tabScore3: 'Vocal scores', tabArrTrans: 'Arrangements', tabScore5: 'Other' };

export async function workFiles(title) {
  const d = await jsonp({ action: 'parse', page: title, prop: 'text', redirects: '1' }, 25000);
  if (!d.parse) throw new Error('missing');
  return { title: d.parse.title, ...parseWorkHtml(d.parse.text['*']) };
}

export function parseWorkHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const files = [];
  for (const [id, group] of Object.entries(TABS)) {
    const tab = doc.getElementById(id);
    if (!tab) continue;
    for (const we of tab.querySelectorAll('.we')) {
      const ed = {};
      const info = we.querySelector('table.we_edition_info');
      if (info) for (const tr of info.querySelectorAll('tr')) {
        const th = tr.querySelector('th'), td = tr.querySelector('td');
        if (th && td) ed[th.textContent.replace(/\s+/g, ' ').trim()] = td.textContent.replace(/\s+/g, ' ').trim();
      }
      // nearest heading above this edition (arrangement name, e.g. "For Cello and Piano (Smith)")
      let heading = '';
      let el = we.previousElementSibling;
      while (el && !heading) { if (/^H[2-6]$/.test(el.tagName)) heading = el.textContent.trim(); el = el.previousElementSibling; }
      for (const fb of we.querySelectorAll('div[id^="IMSLP"]')) {
        const index = fb.id.slice(5);
        const internal = fb.querySelector('a.internal');
        const file = internal ? decodeURIComponent(internal.getAttribute('href').split('/').pop()) : '';
        if (!/\.pdf$/i.test(file)) continue;
        const label = (fb.querySelector('.we_file_download a span[title]') || fb.querySelector('.we_file_download a') || {}).textContent || 'Score';
        const dlEl = fb.querySelector('span[title^="Total number of downloads"]');
        const downloads = dlEl ? parseInt(dlEl.getAttribute('title').replace(/\D+/g, ''), 10) || 0 : 0;
        const meta = (fb.querySelector('.we_file_info2') || {}).textContent || '';
        const pages = (meta.match(/(\d+)\s*pp?\./) || [])[1];
        const size = (meta.match(/([\d.]+)\s*MB/) || [])[1];
        const publisher = ed['Publisher Info.'] || ed['Pub. Info.'] || ed['Publisher. Info.'] || Object.entries(ed).find(([k]) => /^Pub/.test(k))?.[1] || '';
        files.push({
          index, group, label: label.trim(), file, downloads, pages: pages ? +pages : null, size: size ? +size : null,
          editor: ed.Editor || '', arranger: ed.Arranger || '', instrumentation: ed.Instrumentation || '', publisher: publisher.replace(/\s*Plate.*$/, '').trim(),
          copyright: (ed.Copyright || '').replace(/\s*-.*$/, '').trim(), heading,
        });
      }
    }
  }
  return { files };
}

export function rankFiles(files, words) {
  const forMe = (f) => {
    const hay = ' ' + fold([f.label, f.instrumentation, f.heading, f.arranger].join(' ')) + ' ';
    return words.some((w) => hay.includes(' ' + fold(w)) || (w.length > 5 && hay.includes(fold(w))));
  };
  const all = files.map((f) => ({ ...f, mine: words.length ? forMe(f) : false }));
  const byDl = (a, b) => b.downloads - a.downloads;
  const mine = all.filter((f) => f.mine).sort(byDl);
  const score = all.filter((f) => f.group === 'Full scores').sort(byDl);
  const top = [...all].sort(byDl);
  const picks = [];
  if (mine[0]) picks.push({ why: 'mine', f: mine[0] });
  if (score[0] && !picks.some((p) => p.f.index === score[0].index)) picks.push({ why: 'score', f: score[0] });
  if (top[0] && !picks.some((p) => p.f.index === top[0].index)) picks.push({ why: 'top', f: top[0] });
  const groups = {};
  for (const f of all) (groups[f.group] = groups[f.group] || []).push(f);
  for (const g of Object.values(groups)) g.sort((a, b) => (b.mine - a.mine) || byDl(a, b));
  return { picks, groups, mostDownloaded: top[0] ? top[0].index : null };
}

export const fileUrl = (index) => 'https://imslp.org/wiki/Special:ImagefromIndex/' + index;
export const workUrl = (title) => 'https://imslp.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
