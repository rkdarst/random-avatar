import { readFileSync } from 'node:fs';

// Extract the inline script from index.html.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script tag found');
const scriptSrc = m[1];

// --- Browser stubs ---
let ctxLog = [];
function makeCtx() {
  const noop = (...a) => ctxLog.push(a.map(x => typeof x === 'number' ? +x.toFixed(4) : String(x)).join(','));
  const grad = { _stops: [], addColorStop(o, c) { this._stops.push([+o, String(c)]); } };
  return new Proxy({
    createLinearGradient: (...a) => { ctxLog.push('lg:' + a.map(x => +x.toFixed(4)).join(',')); return { addColorStop(o, c) { ctxLog.push('stop:' + c); } }; },
    createRadialGradient: (...a) => { ctxLog.push('rg'); return { addColorStop(o, c) { ctxLog.push('stop:' + c); } }; },
  }, {
    get(t, p) { return t[p] !== undefined ? t[p] : noop; },
    set(t, p, v) { t[p] = v; ctxLog.push('set:' + p + '=' + String(v)); return true; }
  });
}

function makeEl(id) {
  const el = { id, value: '', innerHTML: '', className: '', title: '', style: {},
           children: [], listeners: {},
           getContext: () => ctxs[id] || (ctxs[id] = makeCtx()),
           addEventListener(ev, fn) { this.listeners[ev] = fn; },
           appendChild(c) { this.children.push(c); },
           removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
           fire(ev) { this.listeners[ev] && this.listeners[ev](); } };
  Object.defineProperty(el, 'firstChild', { get() { return this.children[0] || null; } });
  return el;
}
const ctxs = {};
const els = {};
for (const id of ['preview', 'familySelect', 'sizeInput', 'letterInput', 'regenBtn',
                  'downloadBtn', 'seedLink', 'historyGrid', 'historyEmpty', 'clearHistoryBtn'])
  els[id] = makeEl(id);
els.familySelect.value = 'random';
els.sizeInput.value = '256';
// select options must exist for forcedFamily indexOf lookups (value strings only).

const store = { href: 'https://x.test/', hash: '' };
const listeners = {};
const tmpCanvas = () => ({ width: 0, height: 0, className: '', title: '', listeners: {},
  getContext: makeCtx,
  addEventListener(ev, fn) { this.listeners[ev] = fn; },
  fire(ev) { this.listeners[ev] && this.listeners[ev](); },
  toBlob: (fn) => fn(null) });
globalThis.document = { getElementById: (id) => els[id],
  body: { appendChild() {}, removeChild() {} }, createElement: (t) => tmpCanvas() };
globalThis.location = store;
const storage = {};
globalThis.localStorage = { getItem: (k) => (k in storage ? storage[k] : null),
                           setItem: (k, v) => { storage[k] = String(v); } };
Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: (b) => { b[0] = 0x1234abcd; return b; } }, configurable: true });
globalThis.window = { addEventListener: (ev, fn) => { listeners[ev] = fn; } };
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
globalThis.setTimeout = setTimeout;

// Run the page script.
eval(scriptSrc);

let fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL:', name); } else console.log('ok:', name); }

// 1. Initial render happened and wrote a hash.
check('initial hash set', /^[0-9a-f]{1,8}$/.test(store.hash));

// 2. Every family renders without error, both forced and under Random.
const families = ['plain','shapes','rings','stripes','pixels','mirror','waves','rays','blocks','dots','checker','spiral','blobs'];
for (const fam of families) {
  els.familySelect.value = fam; els.familySelect.fire('change');
  check('forced ' + fam + ' -> hash .' + families.indexOf(fam), store.hash === '1234abcd.' + families.indexOf(fam));
}
els.familySelect.value = 'random'; els.familySelect.fire('change');
check('random -> plain seed hash', store.hash === '1234abcd');

// 3. Letter overlay: any character, hash encoding, style text.
els.familySelect.value = 'checker'; els.familySelect.fire('change');
els.letterInput.value = 'k'; els.letterInput.fire('input');
check('letter lowercased into hash', store.hash === '1234abcd.10.k');
check('letter kept as typed in input', els.letterInput.value === 'k');
check('style text shows uppercase letter', els.seedLink.innerHTML.includes('+ K'));
els.familySelect.value = 'random'; els.familySelect.fire('change');
check('letter without family -> seed..c', store.hash === '1234abcd..k');
els.letterInput.value = '#'; els.letterInput.fire('input');
check('punctuation letter url-encoded', store.hash === '1234abcd..%23');
els.letterInput.value = '.'; els.letterInput.fire('input');
check('dot letter stored as %2E', store.hash === '1234abcd..%2E');
els.letterInput.value = '\u{1F388}'; els.letterInput.fire('input');   // balloon emoji
check('emoji letter url-encoded', store.hash === '1234abcd..%F0%9F%8E%88');
els.letterInput.value = ' '; els.letterInput.fire('input');
check('whitespace letter = none', store.hash === '1234abcd');
els.letterInput.value = ''; els.letterInput.fire('input');

// 4. Hash parsing round trips (old and new formats).
els.familySelect.value = 'random'; els.letterInput.value = '';
store.hash = '#deadbeef.3'; listeners.hashchange();
check('old link .3 selects stripes', els.familySelect.value === 'stripes');
store.hash = '#deadbeef.12.x'; listeners.hashchange();
check('.12 selects blobs + letter X', els.familySelect.value === 'blobs' && els.letterInput.value === 'X');
store.hash = '#deadbeef..z'; listeners.hashchange();
check('..z = random + letter Z', els.familySelect.value === 'random' && els.letterInput.value === 'Z' && store.hash === 'deadbeef..z');
store.hash = '#deadbeef.%21'; listeners.hashchange();
check('encoded letter in part 1', els.familySelect.value === 'random' && els.letterInput.value === '!');
store.hash = '#deadbeef.7.%F0%9F%8E%88'; listeners.hashchange();
check('emoji letter in part 3', els.familySelect.value === 'rays' && els.letterInput.value === '\u{1F388}');
store.hash = '#DEADBEEF.13'; listeners.hashchange();
check('family 13 rejected (state untouched)', els.familySelect.value === 'rays' && els.letterInput.value === '\u{1F388}');
store.hash = '#zzz'; listeners.hashchange();
check('garbage hash rejected', els.familySelect.value === 'rays' && els.letterInput.value === '\u{1F388}');

// 5. History: entries recorded, deduped, persisted, clickable, clearable.
check('history recorded entries', els.historyGrid.children.length > 1);
check('history persisted to storage',
      JSON.parse(storage['avatarHistoryV1']).length === els.historyGrid.children.length);
const before = els.historyGrid.children.length;
els.familySelect.fire('change');   // same hash re-rendered: no duplicate
check('no duplicate history entries', els.historyGrid.children.length === before);
check('current entry highlighted',
      els.historyGrid.children.some(c => c.className === 'thumb active'));
check('thumbnails have title hash',
      els.historyGrid.children.every(c => /^#[0-9a-fA-F]/.test(c.title)));
store.hash = '#cafe0001'; listeners.hashchange();
const oldest = els.historyGrid.children[els.historyGrid.children.length - 1];
const oldestHash = oldest.title.slice(1);
oldest.fire('click'); listeners.hashchange();
check('thumbnail click restores entry', store.hash === oldestHash &&
      els.seedLink.innerHTML.includes('Style:'));
els.clearHistoryBtn.fire('click');
check('clear empties grid', els.historyGrid.children.length === 0 &&
      els.historyEmpty.style.display === 'block' &&
      JSON.parse(storage['avatarHistoryV1']).length === 0);
els.regenBtn.fire('click');
check('regenerate re-records history', els.historyGrid.children.length === 1);

// 6. Back-compat: base gradient (first linear-gradient call + stops) must be
// identical for a seed no matter which family is forced.
let gradSigs = new Set();
for (const fam of families) {
  store.hash = '#cafe0001'; listeners.hashchange();
  els.familySelect.value = fam === 'random' ? 'random' : fam; els.familySelect.fire('change');
  const g = ctxs.preview;
  // Re-render into a fresh log to capture just the gradient prefix.
  ctxLog = [];
  // trigger a render via family change
  els.familySelect.fire('change');
  const li = ctxLog.findIndex(s => String(s).startsWith('lg:'));
  gradSigs.add(ctxLog.slice(li, li + 2).join('|'));
}
check('gradient stable across all forced families', gradSigs.size === 1);

// 6. Regenerate and download paths run without error.
ctxLog = [];
els.regenBtn.fire('click');
check('regenerate ok', /^[0-9a-f]{1,8}/.test(store.hash));
els.downloadBtn.fire('click');
check('download path ran', true);

// 8. Palette coherence: every color must stay near the two seed-derived
// base hues (or the rare derived accent), for every family and scheme.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function paletteFor(seed) {
  const r = mulberry32(seed >>> 0);
  r(); r(); r(); r();                     // anchors
  const hueA = r() * 360; r(); r();       // gradient stop A: hue, sat, lig
  const scheme = (seed >>> 17) & 3;
  let hueB;
  if (scheme === 0) hueB = hueA + 20 + r() * 25;
  else if (scheme === 1) hueB = hueA + 150 + r() * 30;
  else if (scheme === 2) hueB = hueA + 160 + r() * 40;
  else hueB = r() * 360;
  r(); r();                              // gradient stop B: sat, lig
  return { hueA: ((hueA % 360) + 360) % 360,
           hueB: ((hueB % 360) + 360) % 360, scheme };
}
function near(h, h0, tol) {
  const d = Math.abs(((h % 360) + 360) % 360 - ((h0 % 360) + 360) % 360);
  return Math.min(d, 360 - d) <= tol;
}
function inPalette(h, pa) {
  return near(h, pa.hueA, 20) || near(h, pa.hueB, 20) || near(h, pa.hueB + 40, 20);
}

const schemeSeeds = [0x500000, 0x520000, 0x540000, 0x560000];   // schemes 0..3
check('scheme seeds cover all 4 palettes',
      new Set(schemeSeeds.map(s => paletteFor(s).scheme)).size === 4);
let paletteOk = true, analogousOk = false;
for (const seed of schemeSeeds.concat([0x1234abcd, 0xdeadbeef, 0xcafe0001])) {
  for (const fam of families) {
    store.hash = '#' + (seed >>> 0).toString(16); listeners.hashchange();
    els.familySelect.value = fam; els.familySelect.fire('change');
    ctxLog = [];
    els.familySelect.fire('change');      // re-render into a fresh log
    const pa = paletteFor(seed);
    const stops = [];
    for (const e of ctxLog) {
      const m = String(e).match(/hsla?\((\d+)/);
      if (m) {
        const h = +m[1];
        if (!inPalette(h, pa)) {
          paletteOk = false;
          console.log('  bad hue', h, 'seed', (seed >>> 0).toString(16), fam, String(e));
        }
      }
      const s = String(e).match(/^stop:hsla?\((\d+)/);
      if (s) stops.push(+s[1]);
    }
    if (pa.scheme === 0 && stops.length >= 2 && near(stops[0], stops[1], 60)) analogousOk = true;
  }
}
check('all colors within palette (7 seeds x 13 families)', paletteOk);
check('analogous scheme keeps gradient stops close', analogousOk);

console.log(fails ? fails + ' FAILURES' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
