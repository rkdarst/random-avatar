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
for (const id of ['preview', 'familySelect', 'tempSelect', 'shapeSelect', 'sizeInput', 'letterInput', 'regenBtn',
                  'downloadBtn', 'seedLink', 'historyGrid', 'historyEmpty', 'clearHistoryBtn'])
  els[id] = makeEl(id);
els.familySelect.value = 'random';
els.tempSelect.value = 'random';
els.shapeSelect.value = 'random';
els.sizeInput.value = '256';
// select options must exist for forcedFamily indexOf lookups (value strings only).

const store = { href: 'https://x.test/', hash: '' };
const listeners = {};
function makeQuietCtx() {
  const noop = () => {};
  return new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  }, { get(t, p) { return t[p] !== undefined ? t[p] : noop; }, set() { return true; } });
}
const tmpCanvas = () => ({ width: 0, height: 0, className: '', title: '', listeners: {},
  getContext: makeQuietCtx,
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
function temperamentFor(seed) {        // temperament bit mapping (mirror)
  const b = (seed >>> 19) & 15;
  return b < 4 ? 0 : b < 8 ? b - 3 : [5, 6, 7, 8, 9, 5, 7, 0][b - 8];
}
const TEMP_ARCS = { 7: [12, 46], 8: [165, 80] };   // hue-locked temperaments
const TEMP_GAPS = { 4: [65, 45], 9: [0, 12] };     // gap-overriding temperaments
function paletteFor(seed) {
  const r = mulberry32(seed >>> 0);
  r(); r(); r(); r();                     // anchors
  const hueA = r() * 360; r(); r();       // gradient stop A: hue, sat, lig
  const scheme = (seed >>> 17) & 3;
  const temp = temperamentFor(seed);
  let hueA2 = hueA, hueB;
  if (TEMP_ARCS[temp]) {                  // hue-locked palette
    const [a0, sp] = TEMP_ARCS[temp];
    hueA2 = a0 + hueA % sp;
    hueB = a0 + (hueA2 - a0 + 20 + r() * 40) % sp;
  }
  else if (TEMP_GAPS[temp]) hueB = hueA + TEMP_GAPS[temp][0] + r() * TEMP_GAPS[temp][1];
  else if (scheme === 0) hueB = hueA + 20 + r() * 25;
  else if (scheme === 1) hueB = hueA + 150 + r() * 30;
  else if (scheme === 2) hueB = hueA + 160 + r() * 40;
  else hueB = r() * 360;
  r(); r();                              // gradient stop B: sat, lig
  return { hueA: ((hueA2 % 360) + 360) % 360,
           hueB: ((hueB % 360) + 360) % 360, scheme, temp };
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
for (const seed of schemeSeeds.concat([0x5, 0x1234abcd, 0xdeadbeef, 0xcafe0001])) {
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
    if (pa.scheme === 0 && ![4, 7, 8, 9].includes(pa.temp) &&
        stops.length >= 2 && near(stops[0], stops[1], 60)) analogousOk = true;
  }
}
check('all colors within palette (7 seeds x 13 families)', paletteOk);
check('analogous scheme keeps gradient stops close', analogousOk);

// 9. Temperaments: seed bits 19-22 or the Palette selector set sat/light
// bands (plus hue gap/arc rules) without touching the RNG draw order.
els.tempSelect.value = 'random'; els.sizeInput.value = '256'; els.letterInput.value = '';
els.familySelect.value = 'random';
store.hash = '#abcd'; listeners.hashchange();
els.familySelect.value = 'blocks'; els.tempSelect.value = 'pastel'; els.familySelect.fire('change');
check('temp appended after family (letter gap kept)', store.hash === 'abcd.8..1');
els.tempSelect.value = 'random'; els.tempSelect.fire('change');
check('random temp drops temp part', store.hash === 'abcd.8');
store.hash = '#abcd..%2E.2'; listeners.hashchange();
check('4-part hash sets letter + temp',
      els.letterInput.value === '.' && els.tempSelect.value === 'muted' &&
      store.hash === 'abcd..%2E.2');
store.hash = '#abcd...10'; listeners.hashchange();   // 10 is past the last name
check('invalid temp index leaves state unchanged', els.tempSelect.value === 'muted');
store.hash = '#abcd'; listeners.hashchange();
check('no-temp hash resets selector to random', els.tempSelect.value === 'random');

// Forced temperaments: every emitted color sits inside the mode's bands
// (gradient stops + pattern colors); clash keeps a 65-110 deg gap, mono a
// <=12 deg gap; earth/ocean lock their gradient stop hues into an arc.
const BANDS = { vivid: [[60, 90], [35, 75]], pastel: [[30, 55], [62, 88]],
                muted: [[12, 38], [36, 70]], dark: [[45, 80], [16, 62]],
                clash: [[75, 95], [30, 80]], neon: [[88, 100], [40, 78]],
                jewel: [[80, 100], [24, 78]], earth: [[25, 55], [32, 66]],
                ocean: [[40, 75], [35, 65]], mono: [[28, 58], [30, 85]] };
const MODE_ARCS = { earth: [12, 46], ocean: [165, 80] };
let bandOk = true, clashHueOk = true;
for (const name of Object.keys(BANDS)) {
  for (const seed of [0x50000000, 0xdeadbeef, 0xcafe0001]) {
    store.hash = '#' + (seed >>> 0).toString(16); listeners.hashchange();
    els.tempSelect.value = name;
    ctxLog = []; els.tempSelect.fire('change');
    const stopHues = [];
    for (const e of ctxLog) {
      const sm = String(e).match(/^stop:hsl\((\d+), ([\d.]+)%, ([\d.]+)%\)$/);
      if (sm) stopHues.push(+sm[1]);
      const mm = String(e).match(/hsla?\((\d+), ([\d.]+)%, ([\d.]+)%/);
      if (!mm) continue;
      const s = +mm[2], l = +mm[3], [sb, lb] = BANDS[name];
      if (s < sb[0] - 0.1 || s > sb[1] + 0.1 || l < lb[0] - 0.1 || l > lb[1] + 0.1) {
        bandOk = false; console.log(' band out:', name, (seed >>> 0).toString(16), s, l);
      }
    }
    if (name === 'clash' && stopHues.length >= 2) {
      const gap = ((stopHues[1] - stopHues[0]) % 360 + 360) % 360;
      if (gap < 64 || gap > 111) {
        clashHueOk = false; console.log(' clash gap out:', (seed >>> 0).toString(16), gap);
      }
    }
    if (MODE_ARCS[name] && stopHues.length >= 2) {   // first two = gradient stops
      const [a0, sp] = MODE_ARCS[name];
      for (const h of stopHues.slice(0, 2)) {
        if (((h - a0) % 360 + 360) % 360 > sp + 1) {
          clashHueOk = false; console.log(' arc out:', name, (seed >>> 0).toString(16), h);
        }
      }
    }
  }
}
check('forced temperaments stay in their sat/light bands', bandOk);
check('clash gap and earth/ocean hue arcs hold', clashHueOk);

// Random mode: the 16 seed-bit buckets 19-22 map to the expected
// temperaments, detected from stop signatures only that mode produces.
els.tempSelect.value = 'random'; els.familySelect.value = 'plain';
const BUCKET = [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 5, 7, 0];
const NAMEOF = ['vivid', 'pastel', 'muted', 'dark', 'clash',
                'neon', 'jewel', 'earth', 'ocean', 'mono'];
let mapOk = true;
for (let b = 0; b < 16; b++) {
  const seed = ((b << 19) | 0x11) >>> 0;   // bits 17-18 = 0 (analogous)
  ctxLog = [];
  store.hash = '#' + seed.toString(16); listeners.hashchange();
  const stops = [];
  for (const e of ctxLog) {
    const sm = String(e).match(/^stop:hsl\((\d+), ([\d.]+)%, ([\d.]+)%\)$/);
    if (sm) stops.push({ h: +sm[1], s: +sm[2], l: +sm[3] });
  }
  const name = NAMEOF[BUCKET[b]];
  const gap = stops.length >= 2 ? ((stops[1].h - stops[0].h) % 360 + 360) % 360 : -1;
  const inArc = (a) => stops.every(t => ((t.h - a[0]) % 360 + 360) % 360 <= a[1]);
  let ok = stops.length >= 2;
  if (ok) switch (name) {
    case 'vivid':  ok = stops.every(t => t.s >= 59.9 && t.s <= 90.1); break;
    case 'pastel': ok = stops.every(t => t.l >= 71.9); break;
    case 'muted':  ok = stops.every(t => t.s <= 38.1); break;
    case 'dark':   ok = stops.every(t => t.l <= 32.1); break;
    case 'clash':  ok = gap >= 64 && gap <= 111; break;
    case 'neon':   ok = stops.every(t => t.s >= 87.9); break;
    case 'jewel':  ok = stops.every(t => t.s >= 79.9 && t.l <= 40.1); break;
    case 'earth':  ok = inArc([12, 46]); break;
    case 'ocean':  ok = inArc([165, 80]); break;
    case 'mono':   ok = gap <= 12.5 && stops.every(t => t.s >= 27.9 && t.s <= 58.1); break;
  }
  if (!ok) { mapOk = false; console.log(' bucket', b, name, JSON.stringify(stops)); }
}
check('seed bits 19-22 map to the temperament buckets', mapOk);

// Old links (no temp part) keep the vivid bands on their gradient stops.
els.familySelect.value = 'random';
ctxLog = [];
store.hash = '#80000'; listeners.hashchange();   // bits 19-22 = 1 -> vivid
let oldLinkOk = true;
for (const e of ctxLog) {
  const mm = String(e).match(/^stop:hsl\((\d+), ([\d.]+)%, ([\d.]+)%\)$/);
  if (mm) { const s = +mm[2], l = +mm[3];
    if (s < 59.9 || s > 90.1 || l < 39.9 || l > 70.1) oldLinkOk = false; }
}
check('old links (no temp part) stay vivid-banded',
      oldLinkOk && ((0x80000 >>> 19) & 15) < 4);

// 10. Shapes: seed bits 23-26 pick a silhouette mask with zero RNG, the
// Shape selector forces one (5th hash part), and the mask never adds any
// draw before the layer stack it clips.
const shapeNames = ['none', 'circle', 'rounded', 'hexagon', 'shield',
                    'diamond', 'star', 'blob', 'pill'];
els.familySelect.value = 'random'; els.tempSelect.value = 'random';
els.shapeSelect.value = 'random'; els.letterInput.value = '';

// Bucket mapping, detected from the shape name shown in the style line.
let shapeMapOk = true;
for (let k = 0; k < 8; k++) {
  store.hash = '#deadbeef'; listeners.hashchange();   // wipe stale style text
  store.hash = '#' + (((k << 23) | 0x11) >>> 0).toString(16) + '.0';
  listeners.hashchange();
  if (!els.seedLink.innerHTML.includes(shapeNames[1 + k])) {
    shapeMapOk = false;
    console.log(' shape bucket', k, 'want', shapeNames[1 + k], els.seedLink.innerHTML);
  }
}
check('seed bits 23-26 map to the shape silhouettes', shapeMapOk);

// Forced shapes: 5th hash part, style line, and the mask draw itself.
store.hash = '#cafe0001.0'; listeners.hashchange();
els.shapeSelect.value = 'hexagon'; els.shapeSelect.fire('change');
check('forced shape -> 5th hash part', store.hash === 'cafe0001.0...3');
check('style line shows the forced shape', els.seedLink.innerHTML.includes('hexagon'));
ctxLog = [];
els.shapeSelect.fire('change');
check('mask uses destination-in compositing',
      ctxLog.some(e => String(e) === 'set:globalCompositeOperation=destination-in'));
els.shapeSelect.value = 'none'; els.shapeSelect.fire('change');
ctxLog = []; els.shapeSelect.fire('change');
const noMask = ctxLog.slice();
check('square shape emits no compositing',
      !noMask.some(e => String(e).startsWith('set:globalCompositeOperation')));
els.shapeSelect.value = 'hexagon'; els.shapeSelect.fire('change');
ctxLog = []; els.shapeSelect.fire('change');
const mi = ctxLog.findIndex(e => String(e) === 'set:globalCompositeOperation=destination-in');
check('mask changes nothing before its own layer (geometry stable)',
      mi > 1 && noMask.length === mi - 1 &&
      ctxLog.slice(0, mi - 1).every((e, i) => e === noMask[i]));

// 5-part hash round trips; out-of-range and 6-part hashes are rejected.
store.hash = '#abcd.3.7.2.6'; listeners.hashchange();
check('5-part hash sets family, letter, temp, shape',
      els.familySelect.value === 'stripes' && els.letterInput.value === '7' &&
      els.tempSelect.value === 'muted' && els.shapeSelect.value === 'star' &&
      store.hash === 'abcd.3.7.2.6');
store.hash = '#abcd....4'; listeners.hashchange();
check('shape-only part after empty gaps', els.shapeSelect.value === 'shield' &&
      els.familySelect.value === 'random' && store.hash === 'abcd....4');
store.hash = '#abcd.0..0.0'; listeners.hashchange();
check('forced square writes shape part 0', els.shapeSelect.value === 'none' &&
      els.tempSelect.value === 'vivid' && store.hash === 'abcd.0..0.0');
store.hash = '#abcd....9'; listeners.hashchange();
check('shape index 9 rejected (state untouched)', els.shapeSelect.value === 'none');
store.hash = '#abcd.1.2.3.4.5'; listeners.hashchange();
check('6-part hash rejected (state untouched)',
      els.shapeSelect.value === 'none' && els.familySelect.value === 'plain');

// History thumbnails carry the forced shape back.
els.familySelect.value = 'plain'; els.tempSelect.value = 'random';
els.shapeSelect.value = 'pill'; els.shapeSelect.fire('change');
const pillThumb = els.historyGrid.children.find(c => c.title === '#abcd.0...8');
if (pillThumb) { pillThumb.fire('click'); listeners.hashchange(); }
check('thumbnail click restores the forced shape',
      !!pillThumb && els.shapeSelect.value === 'pill' && store.hash === 'abcd.0...8');

console.log(fails ? fails + ' FAILURES' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
