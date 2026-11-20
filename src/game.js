// Catnap — game UI
{
  const E = window.CatnapEngine;
  const LG = window.CatnapLogic;
  const I = window.CatnapI18n;
  const A = window.CatnapAudio;
  const MU = window.CatnapMusic;
  const LEVELS = window.CatnapLevels;
  const ACH = window.CatnapAch;
  const t = I.t;
  const $ = id => document.getElementById(id);
  const EMPTY = 0, MARK = 1, CAT = 2;
  const LETTERS = 'ABCDEFGHIJ';
  const SITE = 'https://alexc0906.github.io/catnap-puzzle/';
  // Daily schedule by weekday (0 = Sunday): [size, tier]
  const DAILY = [[9, 3], [6, 0], [7, 1], [8, 1], [8, 2], [9, 2], [10, 2]];
  const SKINS = [
    { id: 'ginger', ok: () => true },
    { id: 'tabby', ok: p => totalStars(p) >= 10 },
    { id: 'black', ok: p => totalStars(p) >= 30 },
    { id: 'tux', ok: p => p.daily.best >= 3 },
    { id: 'calico', ok: p => totalStars(p) >= 60 },
    { id: 'siamese', ok: p => totalStars(p) >= 100 },
    { id: 'white', ok: p => totalStars(p) >= 150 },
    { id: 'galaxy', ok: p => totalStars(p) >= 180 }
  ];

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('catnap:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('catnap:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    clear() { try { Object.keys(localStorage).filter(k => k.startsWith('catnap:')).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ } }
  };
  const defaultSettings = () => ({ sound: true, autoX: false, showErr: true, cb: false, coach: false, hideTimer: false, music: false, skin: 'ginger' });
  const defaultProgress = () => ({ stars: {}, best: {}, solved: 0, byTier: [0, 0, 0, 0], daily: { last: null, streak: 0, best: 0, done: {} }, skins: ['ginger'], ach: {}, flags: {} });
  let settings = Object.assign(defaultSettings(), store.get('settings', {}));
  let progress = Object.assign(defaultProgress(), store.get('progress', {}));
  const saveSettings = () => store.set('settings', settings);
  const saveProgress = () => store.set('progress', progress);
  function totalStars(p = progress) { return Object.values(p.stars).reduce((a, b) => a + b, 0); }

  // ---------- state ----------
  let mode = store.get('mode', 'daily');
  let free = Object.assign({ n: 8, tier: 1 }, store.get('free', {}));
  let P = null, meta = null, geom = null;
  let cells = [], history = [], batch = null, els = [];
  let startTime = 0, elapsed = 0, ticking = false, won = false, paused = false, hintsUsed = 0;
  let hint = null, lastStars = 0, lastRecord = false, loadToken = 0, dailyDate = null, pausedByDialog = false;

  // ---------- dates ----------
  const pad = x => String(x).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => dateKey(new Date());
  const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dateKey(d); };
  const locale = () => (I.lang === 'ro' ? 'ro-RO' : 'en-US');
  const longDate = (key = todayKey()) => { try { return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(parseKey(key)); } catch { return key; } };

  // ---------- generation (worker when possible) ----------
  let worker = null;
  const pending = new Map();
  try {
    worker = new Worker('src/worker.js');
    worker.onmessage = e => { const cb = pending.get(e.data.id); pending.delete(e.data.id); if (cb) cb(e.data.puzzle); };
    worker.onerror = () => { worker = null; for (const [, cb] of pending) cb(null); pending.clear(); };
  } catch { worker = null; }
  const cache = new Map();
  function generate(n, tier, seed) {
    const key = `${n}-${tier}-${seed}`;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise(resolve => {
      const done = p => { if (p) cache.set(key, p); resolve(p); };
      const local = () => setTimeout(() => done(LG.generateRated(E, n, tier, seed)), 30);
      if (!worker) return local();
      const id = Math.random().toString(36).slice(2);
      pending.set(id, p => p ? done(p) : local());
      worker.postMessage({ id, n, tier, seed });
    });
  }

  // ---------- loading puzzles ----------
  function showLoading(on) { $('loading').hidden = !on; }
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const dailyPlan = key => DAILY[parseKey(key).getDay()];
  async function loadDaily(key = todayKey()) {
    const tok = ++loadToken;
    if (key > todayKey()) key = todayKey();
    dailyDate = key;
    const [n, tier] = dailyPlan(key);
    const delay = setTimeout(() => showLoading(true), 120);
    const p = await generate(n, tier, E.hashString('catnap-daily-' + key));
    clearTimeout(delay); showLoading(false);
    if (tok !== loadToken || !p) return;
    start(p, { kind: 'daily', id: 'daily-' + key, tier: p.tier, date: key });
  }
  function loadLevel(k) {
    ++loadToken;
    k = Math.max(1, Math.min(LEVELS.length, k));
    const L = LEVELS[k - 1];
    const regions = [...L.r].map(Number);
    const solution = E.solve(L.n, regions, 1)[0];
    store.set('level', k);
    start({ n: L.n, regions, solution, tier: L.tier }, { kind: 'level', id: 'level-' + k, tier: L.tier, level: k });
  }
  async function loadFree(n, tier, seed) {
    const tok = ++loadToken;
    if (!LG.TIER_SIZES[tier].includes(n)) n = LG.TIER_SIZES[tier].reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a);
    free = { n, tier, seed: seed ?? ((Math.random() * 1e9) >>> 0) };
    store.set('free', free);
    renderModebar();
    const delay = setTimeout(() => showLoading(true), 120);
    const p = await generate(free.n, free.tier, free.seed);
    clearTimeout(delay); showLoading(false);
    if (tok !== loadToken || !p) return;
    start(p, { kind: 'free', id: `f-${free.n}-${free.tier}-${free.seed}`, tier: p.tier });
  }
  function loadMode(m, opts = {}) {
    if (M) quitMarathon(true);
    mode = m; store.set('mode', m);
    renderTabs();
    if (m === 'daily') loadDaily(opts.date);
    else if (m === 'journey') loadLevel(opts.level ?? store.get('level', firstOpenLevel()));
    else if (m === 'workshop') { if (opts.custom) loadCustom(opts.custom.n, opts.custom.regions); else openEditor(); }
    else loadFree(opts.n ?? free.n, opts.tier ?? free.tier, opts.seed ?? (opts.fresh ? undefined : free.seed));
    renderModebar();
  }
  function firstOpenLevel() {
    for (let k = 1; k <= LEVELS.length; k++) if (!progress.stars[k]) return k;
    return LEVELS.length;
  }
  const levelOpen = k => k === 1 || !!progress.stars[k - 1] || !!progress.stars[k];

  function start(puzzle, m) {
    if (editing) stopEditing();
    P = puzzle; meta = m;
    geom = LG.makeGeometry(P.n, P.regions);
    if (!P.colors) P.colors = assignColors(P.n, P.regions);
    const N = P.n * P.n;
    const saved = store.get('save:' + m.id, null);
    cells = new Array(N).fill(EMPTY); history = []; redoStack = []; batch = null; prevBad = new Set(); prevDone = null;
    elapsed = 0; ticking = false; won = false; paused = false; hintsUsed = 0; hint = null;
    lastStars = 0; lastRecord = false;
    if (saved && saved.cells && saved.cells.length === N) {
      cells = saved.cells; elapsed = saved.elapsed || 0; hintsUsed = saved.hints || 0; won = !!saved.won;
      lastStars = saved.stars || 0;
    }
    try { window.history.replaceState(null, '', '#' + (m.kind === 'daily' ? (m.date === todayKey() ? 'daily' : m.id) : m.id)); } catch { /* sandboxed */ }
    buildBoard($('board'), P, true);
    $('win').hidden = true; $('pauseOv').hidden = true;
    if (m.kind !== 'marathon') $('timerLabel').textContent = t('time');
    clearHint();
    setMood(''); poke();
    renderName(); renderModebar();
    update();
    if (won) showWin(false);
    else if (coachActive()) showHint(computeHint(), false);
  }

  // ---------- colors ----------
  // Palette pairs that look alike; keep them away from neighbouring cushions.
  const SIMILAR = [[1, 8], [2, 6], [2, 7], [3, 9], [4, 9], [0, 5], [0, 8], [6, 7], [3, 7]];
  const simSet = new Set(SIMILAR.flatMap(([a, b]) => [a * 10 + b, b * 10 + a]));
  function assignColors(n, regions) {
    const adj = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < n * n; i++) {
      const r = (i / n) | 0, c = i % n;
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr >= n || cc < 0 || cc >= n) continue;
        const a = regions[i], b = regions[rr * n + cc];
        if (a !== b) { adj[a].add(b); adj[b].add(a); }
      }
    }
    const cost = map => { let k = 0; for (let a = 0; a < n; a++) for (const b of adj[a]) if (b > a && simSet.has(map[a] * 10 + map[b])) k++; return k; };
    const rnd = E.mulberry32(E.hashString(regions.join('')));
    let best = [...Array(n).keys()], bestCost = cost(best);
    // pool: when n < 10 we may also pick which palette entries to use
    for (let tries = 0; tries < 400 && bestCost > 0; tries++) {
      const pool = [...Array(10).keys()];
      for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
      const map = pool.slice(0, n);
      const c = cost(map);
      if (c < bestCost) { best = map; bestCost = c; }
    }
    return best;
  }

  // ---------- board ----------
  function buildBoard(board, p, interactive) {
    const { n, regions } = p;
    board.style.gridTemplateColumns = `repeat(${n}, minmax(0,1fr))`;
    board.style.gridTemplateRows = `repeat(${n}, minmax(0,1fr))`;
    board.className = 'board';
    const thick = n >= 9 ? '2.5px' : '3px';
    let html = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c, g = regions[i];
      const diff = (rr, cc) => rr < 0 || cc < 0 || rr >= n || cc >= n ? false : regions[rr * n + cc] !== g;
      const b = (rr, cc) => diff(rr, cc) ? thick : '0px';
      const tag = interactive ? 'button type="button" role="gridcell"' : 'div';
      html += `<${tag} class="cell" data-i="${i}" data-l="${LETTERS[g]}" style="--d:${(r + c) * 22}ms;--rc:var(--r${p.colors ? p.colors[g] : g});--bt:${b(r - 1, c)};--bb:${b(r + 1, c)};--bl:${b(r, c - 1)};--br:${b(r, c + 1)}"></${interactive ? 'button' : 'div'}>`;
    }
    board.innerHTML = html;
    if (interactive) {
      els = [...board.children];
      board.classList.add('deal');
      clearTimeout(buildBoard.t);
      buildBoard.t = setTimeout(() => board.classList.remove('deal'), 450 + n * 2 * 22);
    }
    return board;
  }

  function blockedSet() {
    const blocked = new Uint8Array(P.n * P.n);
    cells.forEach((s, i) => { if (s === CAT) for (const j of geom.attacks[i]) blocked[j] = 1; });
    return blocked;
  }
  function conflicts() {
    const bad = new Set(); let count = 0;
    cells.forEach((s, i) => {
      if (s !== CAT) return;
      count++;
      for (const j of geom.attacks[i]) if (cells[j] === CAT) { bad.add(i); bad.add(j); }
    });
    return { bad, count };
  }

  function update() {
    if (!P) return;
    const { n } = P;
    const { bad, count } = conflicts();
    const newlyBad = [...bad].filter(i => !prevBad.has(i));
    prevBad = bad;
    const blocked = settings.autoX ? blockedSet() : null;
    const hf = new Set(hint?.focus || []), ht = new Set(hint?.targets || []), hp = hint?.place;
    els.forEach((el, i) => {
      const s = cells[i];
      const want = s === CAT ? 'cat' : s === MARK ? 'x' : blocked && blocked[i] ? 'auto' : '';
      if (el.dataset.v !== want) {
        el.dataset.v = want;
        el.innerHTML = want === 'cat' ? `<svg class="c" style="--bd:-${(Math.random() * 3.6).toFixed(2)}s"><use href="#cat"/></svg>`
          : want === 'x' ? '<svg class="x"><use href="#ex"/></svg>'
          : want === 'auto' ? '<svg class="x auto"><use href="#ex"/></svg>' : '';
      }
      el.classList.toggle('bad', settings.showErr && bad.has(i));
      el.classList.toggle('hf', hf.has(i));
      el.classList.toggle('ht', ht.has(i));
      el.classList.toggle('hp', hp === i);
      el.setAttribute('aria-label', t('cell', { r: ((i / n) | 0) + 1, c: i % n + 1 }) + (s === CAT ? t('cellCat') : s === MARK ? t('cellMark') : ''));
    });
    $('board').classList.toggle('hinting', !!hint && (hf.size > 0 || ht.size > 0 || hp != null));
    // cushions that just received their (non-conflicting) cat
    const done = new Set();
    geom.regs.forEach((rc, g) => { const cs = rc.filter(i => cells[i] === CAT); if (cs.length === 1 && !bad.has(cs[0])) done.add(g); });
    if (prevDone && count < n) {
      const fresh = [...done].filter(g => !prevDone.has(g));
      fresh.forEach(g => geom.regs[g].forEach(i => { const el = els[i]; el.classList.remove('glow'); void el.offsetWidth; el.classList.add('glow'); }));
      if (fresh.length) setTimeout(() => A.play('chime', done.size - 1), 90);
    }
    prevDone = done;
    if (newlyBad.length) {
      newlyBad.forEach(i => { const c = els[i].querySelector('.c'); if (c) { c.classList.remove('hiss'); void c.getBBox; requestAnimationFrame(() => c.classList.add('hiss')); } });
      setMood('scared', 1300);
      if (Math.random() < 0.5) sayFrom('sayConflict');
    }
    $('catCount').textContent = `${count}/${n}`;
    $('undo').disabled = !history.length || won;
    $('hint').disabled = won;
    $('pause').disabled = won;
    if (!won && count === n && bad.size === 0) finish();
    save();
  }

  function save() {
    if (!meta || meta.kind === 'marathon') return;
    store.set('save:' + meta.id, { cells, elapsed: currentElapsed(), hints: hintsUsed, won, stars: lastStars });
  }

  // ---------- workshop ----------
  let editing = false, ed = null, brush = 0, wsValid = false, edTouched = false;
  const encodeRegions = r => r.join('');
  function loadCustom(n, regions) {
    ++loadToken;
    const sols = E.solve(n, regions, 2);
    if (sols.length !== 1) { openEditor({ n, regions }); return; }
    const tier = LG.tierOf(LG.rate(n, regions));
    start({ n, regions, solution: sols[0], tier: tier < 0 ? 3 : tier, colors: [...Array(n).keys()] },
      { kind: 'custom', id: `c-${n}-${encodeRegions(regions)}`, tier: tier < 0 ? 3 : tier });
  }
  function openEditor(from) {
    ++loadToken;
    const saved = store.get('workshop', null);
    ed = from ? { n: from.n, regions: from.regions.slice() } : saved && saved.regions && saved.regions.length === saved.n * saved.n ? saved : { n: 7, regions: new Array(49).fill(-1) };
    editing = true; P = null; meta = null; hint = null;
    setMood('');
    ticking = false; won = false; paused = false;
    $('win').hidden = true; $('pauseOv').hidden = true; $('hintBox').hidden = true;
    document.querySelector('.side').classList.add('editing');
    try { window.history.replaceState(null, '', '#workshop'); } catch { /* sandboxed */ }
    if (brush >= ed.n) brush = 0;
    buildEditBoard();
    renderPalette();
    validateEditor();
    renderModebar();
  }
  function stopEditing() {
    editing = false;
    document.querySelector('.side').classList.remove('editing');
    $('board').classList.remove('editing');
  }
  function buildEditBoard() {
    const board = $('board');
    const n = ed.n;
    board.style.gridTemplateColumns = `repeat(${n}, minmax(0,1fr))`;
    board.style.gridTemplateRows = `repeat(${n}, minmax(0,1fr))`;
    board.className = 'board editing';
    let html = '';
    for (let i = 0; i < n * n; i++) html += `<button type="button" class="cell" data-i="${i}" aria-label="${t('cell', { r: ((i / n) | 0) + 1, c: i % n + 1 })}"></button>`;
    board.innerHTML = html;
    els = [...board.children];
    paintEditBoard();
  }
  function paintEditBoard(mark = []) {
    const n = ed.n, R = ed.regions, thick = n >= 9 ? '2.5px' : '3px';
    const mk = new Set(mark);
    els.forEach((el, i) => {
      const r = (i / n) | 0, c = i % n, g = R[i];
      const b = (rr, cc) => rr < 0 || cc < 0 || rr >= n || cc >= n || R[rr * n + cc] === g ? '0px' : thick;
      el.style.cssText = `--rc:${g < 0 ? 'transparent' : `var(--r${g})`};--bt:${b(r - 1, c)};--bb:${b(r + 1, c)};--bl:${b(r, c - 1)};--br:${b(r, c + 1)}`;
      el.classList.toggle('blank', g < 0);
      el.classList.toggle('ht', mk.has(i));
      el.dataset.l = g < 0 ? '' : LETTERS[g];
    });
  }
  function renderPalette() {
    $('palette').innerHTML = [...Array(ed.n).keys()].map(g => `<button type="button" class="swatch" data-g="${g}" style="--rc:var(--r${g})" aria-pressed="${brush === g}" aria-label="${colorName(g)}">${settings.cb ? LETTERS[g] : ''}</button>`).join('')
      + `<button type="button" class="swatch eraser" data-g="-1" aria-pressed="${brush === -1}" aria-label="${t('wsEraser')}" title="${t('wsEraser')}"></button>`;
  }
  $('palette').addEventListener('click', e => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    brush = +b.dataset.g;
    renderPalette();
  });
  function componentsOk(n, R, g) {
    const cells = []; for (let i = 0; i < n * n; i++) if (R[i] === g) cells.push(i);
    if (!cells.length) return 'missing';
    const seen = new Set([cells[0]]), stack = [cells[0]];
    while (stack.length) {
      const i = stack.pop(), r = (i / n) | 0, c = i % n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const j = rr * n + cc;
        if (R[j] === g && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    return seen.size === cells.length ? 'ok' : 'split';
  }
  function validateEditor() {
    const n = ed.n, R = ed.regions;
    store.set('workshop', ed);
    const checks = [];
    const left = R.filter(g => g < 0).length;
    checks.push([left === 0, left === 0 ? t('wsPainted') : t('wsLeft', { k: left })]);
    const missing = [], split = [];
    for (let g = 0; g < n; g++) { const st = componentsOk(n, R, g); if (st === 'missing') missing.push(colorName(g)); else if (st === 'split') split.push(colorName(g)); }
    const regionsOk = !missing.length && !split.length;
    checks.push([regionsOk, regionsOk ? t('wsRegions') : [missing.length ? t('wsMissing', { list: I.list(missing) }) : '', split.length ? t('wsSplit', { list: I.list(split) }) : ''].filter(Boolean).join(' · ')]);
    let mark = [];
    wsValid = false;
    if (left === 0 && regionsOk) {
      const sols = E.solve(n, R, 2);
      if (sols.length === 0) checks.push([false, t('wsNone')]);
      else if (sols.length > 1) {
        checks.push([false, t('wsMany')]);
        mark = sols[0].map((c, r) => r * n + c).concat(sols[1].map((c, r) => r * n + c)).filter((i, k, a) => sols[0][(i / n) | 0] !== sols[1][(i / n) | 0] && a.indexOf(i) === k);
      } else {
        checks.push([true, t('wsUnique')]);
        const tier = LG.tierOf(LG.rate(n, R));
        checks.push([true, tier < 0 ? t('wsGuess') : t('wsTier', { tier: t('tier' + tier) })]);
        wsValid = true;
        if (edTouched && !progress.flags?.created) award('created');
      }
    }
    $('wsChecks').innerHTML = checks.map(([ok, txt]) => `<li class="${ok ? 'ok' : 'bad'}">${txt}</li>`).join('');
    $('wsPlay').disabled = !wsValid;
    $('wsCopy').disabled = !wsValid;
    $('wsMsg').textContent = '';
    paintEditBoard(mark);
  }
  let edDrag = false;
  function editPaint(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cell');
    if (!el || !$('board').contains(el)) return;
    const i = +el.dataset.i;
    if (ed.regions[i] === brush) return;
    ed.regions[i] = brush;
    edTouched = true;
    A.play(brush < 0 ? 'clear' : 'mark');
    paintEditBoard();
  }
  function setEditSize(n) {
    ed = { n, regions: new Array(n * n).fill(-1) };
    if (brush >= n) brush = 0;
    buildEditBoard(); renderPalette(); validateEditor(); renderModebar();
  }
  function randomEdit() {
    const p = E.generate(ed.n, (Math.random() * 1e9) >>> 0);
    if (!p) return;
    ed = { n: ed.n, regions: p.regions.slice() };
    paintEditBoard(); validateEditor();
  }
  function customLink() { return SITE + `#c-${ed.n}-${encodeRegions(ed.regions)}`; }
  $('wsPlay').addEventListener('click', () => { if (wsValid) loadCustom(ed.n, ed.regions.slice()); });
  $('wsCopy').addEventListener('click', async () => {
    if (!wsValid) return;
    try { await navigator.clipboard.writeText(customLink()); $('wsMsg').textContent = t('wsLinkCopied'); }
    catch { $('wsMsg').textContent = customLink(); }
  });

  // ---------- input ----------
  let drag = null, prevBad = new Set(), prevDone = null, lastTap = null;
  const DOUBLE_TAP_MS = 380;
  const canPlay = () => P && !won && !paused && $('loading').hidden;
  let redoStack = [];
  function setCell(i, v) {
    if (cells[i] === v) return;
    batch.push({ i, prev: cells[i], next: v });
    cells[i] = v;
  }
  function startClock() { if (!ticking && !won && !paused) { ticking = true; startTime = performance.now(); } }
  function commit() {
    const changed = batch && batch.length;
    if (changed) { history.push(batch); redoStack = []; }
    batch = null; drag = null;
    if (changed && hint) { clearHint(); if (coachActive()) setTimeout(() => !won && showHint(computeHint(), false), 60); }
    update();
  }
  const buzz = ms => { try { if (settings.sound && navigator.vibrate) navigator.vibrate(ms); } catch { /* unsupported */ } };
  function soundFor(v, i) {
    if (v === CAT) buzz(10);
    if (v === CAT) A.play(geom.attacks[i].some(j => cells[j] === CAT) ? 'error' : 'cat');
    else if (v === MARK) A.play('mark');
    else A.play('clear');
  }

  const board = $('board');
  board.addEventListener('pointerdown', e => {
    if (editing) { e.preventDefault(); edDrag = true; editPaint(e); return; }
    if (won && $('win').hidden) { $('win').hidden = false; return; }
    const el = e.target.closest('.cell');
    if (!el || !canPlay()) return;
    e.preventDefault();
    const i = +el.dataset.i;
    const now = performance.now();
    startClock();
    let next;
    if (e.button === 2) {
      batch = [];
      next = cells[i] === CAT ? EMPTY : CAT; drag = null; lastTap = null;
    } else if (lastTap && lastTap.i === i && now - lastTap.time < DOUBLE_TAP_MS && history[history.length - 1] === lastTap.batch) {
      // double tap: undo the first tap, then toggle a cat
      history.pop();
      cells[i] = lastTap.prev;
      batch = [];
      next = lastTap.prev === CAT ? EMPTY : CAT;
      drag = null; lastTap = null;
    } else {
      // single tap: × on, × off (a single tap on a cat removes it)
      batch = [];
      next = cells[i] === EMPTY ? MARK : EMPTY;
      drag = next === MARK ? { mode: MARK, seen: new Set([i]) } : cells[i] === MARK ? { mode: EMPTY, seen: new Set([i]) } : null;
      lastTap = { i, time: now, prev: cells[i], batch };
    }
    setCell(i, next); soundFor(next, i);
    update();
  });
  board.addEventListener('pointermove', e => {
    if (editing) { if (edDrag) editPaint(e); return; }
    if (!drag || !batch) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cell');
    if (!el || !board.contains(el)) return;
    const i = +el.dataset.i;
    if (drag.seen.has(i)) return;
    drag.seen.add(i);
    lastTap = null;
    if (drag.mode === MARK && cells[i] === EMPTY) { setCell(i, MARK); A.play('mark'); }
    else if (drag.mode === EMPTY && cells[i] === MARK) setCell(i, EMPTY);
    update();
  });
  const endDrag = () => { if (edDrag) { edDrag = false; validateEditor(); } if (batch) commit(); };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  board.addEventListener('contextmenu', e => e.preventDefault());
  board.addEventListener('keydown', e => {
    const el = e.target.closest('.cell');
    if (!el || (!P && !editing)) return;
    const n = editing ? ed.n : P.n, i = +el.dataset.i;
    const moves = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 };
    if (moves[e.key] != null) {
      const j = i + moves[e.key];
      if (j >= 0 && j < n * n && !(e.key === 'ArrowLeft' && i % n === 0) && !(e.key === 'ArrowRight' && i % n === n - 1)) els[j].focus();
      e.preventDefault(); e.stopPropagation();
    } else if (/^[xXcC ]$/.test(e.key) || e.key === 'Backspace' || e.key === 'Delete') {
      if (editing) { if (e.key === ' ') { e.preventDefault(); ed.regions[i] = brush; validateEditor(); } return; }
      if (!canPlay()) return;
      e.preventDefault(); e.stopPropagation();
      batch = []; startClock();
      const v = /x/i.test(e.key) ? (cells[i] === MARK ? EMPTY : MARK) : /c/i.test(e.key) ? (cells[i] === CAT ? EMPTY : CAT) : e.key === ' ' ? (cells[i] + 1) % 3 : EMPTY;
      setCell(i, v); soundFor(v, i);
      commit();
    }
  });
  board.addEventListener('click', e => {
    if (e.detail !== 0) return; // keyboard "Enter" only
    if (editing) { const el = e.target.closest('.cell'); if (el) { ed.regions[+el.dataset.i] = brush; validateEditor(); } return; }
    const el = e.target.closest('.cell');
    if (!el || !canPlay()) return;
    const i = +el.dataset.i;
    batch = []; startClock();
    const v = cells[i] === EMPTY ? MARK : EMPTY;
    setCell(i, v); soundFor(v, i);
    commit();
  });

  function undo() {
    if (won || paused || !history.length) return;
    const b = history.pop();
    for (let k = b.length - 1; k >= 0; k--) cells[b[k].i] = b[k].prev;
    redoStack.push(b);
    A.play('clear');
    clearHint();
    update();
  }
  function redo() {
    if (won || paused || !redoStack.length) return;
    const b = redoStack.pop();
    for (const c of b) cells[c.i] = c.next;
    history.push(b);
    A.play('mark');
    clearHint();
    update();
  }
  function restart() {
    if (!P) return;
    if (won) {
      won = false; lastStars = 0; elapsed = 0; ticking = false; hintsUsed = 0;
      $('win').hidden = true; $('board').classList.remove('won');
    }
    if (paused) togglePause(false);
    batch = [];
    cells.forEach((v, i) => { if (v !== EMPTY) setCell(i, EMPTY); });
    clearHint();
    commit();
    if (coachActive()) showHint(computeHint(), false);
  }
  $('undo').addEventListener('click', undo);
  $('reset').addEventListener('click', restart);

  // ---------- pause ----------
  function togglePause(on = !paused) {
    if (!P || won) return;
    if (on && !paused) { elapsed = currentElapsed(); ticking = false; paused = true; }
    else if (!on && paused) { paused = false; if (elapsed > 0) startClock(); }
    $('pauseOv').hidden = !paused;
    $('pause').textContent = t(paused ? 'resume' : 'pause');
    setMood(baseMood());
    save();
  }
  $('pause').addEventListener('click', () => togglePause());
  $('resumeBtn').addEventListener('click', () => togglePause(false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ticking && !won) togglePause(true);
    if (document.hidden) MU.stop(); else if (settings.music) MU.start();
  });
  // browsers only allow audio after a user gesture
  const firstGesture = () => { if (settings.music) MU.start(); window.removeEventListener('pointerdown', firstGesture); window.removeEventListener('keydown', firstGesture); };
  window.addEventListener('pointerdown', firstGesture);
  window.addEventListener('keydown', firstGesture);

  // ---------- hints ----------
  const coachActive = () => P && !won && meta && meta.kind !== 'marathon' && (settings.coach || (meta.kind === 'level' && meta.level <= 2 && !progress.stars[meta.level]));
  let nameColors = null; // set while describing a puzzle other than the current one
  const colorName = g => t('colors')[nameColors ? nameColors[g] : !editing && P && P.colors ? P.colors[g] : g];
  function unitName(u, cap) {
    if (u.kind === 'region') return t(cap ? 'Region' : 'region', { color: colorName(u.index) });
    return t((cap ? (u.kind === 'row' ? 'Row' : 'Col') : u.kind), { k: u.index + 1 });
  }
  function describe(step) {
    switch (step.tech) {
      case 'single': return t('hSingle', { Unit: unitName(step.unit, true) });
      case 'confine':
        if (step.unit.kind === 'region') return t('hConfineRegion', { unit: unitName(step.unit), line: unitName(step.target) });
        return t('hConfineLine', { unit: unitName(step.unit), region: unitName({ kind: 'region', index: step.target.index }) });
      case 'blocker': return t('hBlocker', { unit: unitName(step.unit) });
      case 'subset': {
        const k = step.units.length;
        if (step.direction === 'regionsInLines') {
          return t('hSubsetR', {
            Units: t('Regions', { list: I.list(step.units.map(u => colorName(u.index))) }),
            lines: t(step.lines.kind === 'row' ? 'rows' : 'cols', { list: I.list(step.lines.indices.map(x => x + 1)) }), k
          });
        }
        return t('hSubsetL', {
          Units: t(step.axis === 'row' ? 'Rows' : 'Cols', { list: I.list(step.units.map(u => u.index + 1)) }),
          lines: t('regions', { list: I.list(step.lines.indices.map(colorName)) }), k
        });
      }
      default: return t('hContra');
    }
  }
  function computeHint() {
    if (!P || won) return null;
    const { n, solution } = P;
    for (let i = 0; i < n * n; i++) if (cells[i] === CAT && solution[(i / n) | 0] !== i % n) return { kind: 'wrongCat', text: t('hintWrongCat'), targets: [i], fix: [[i, EMPTY]] };
    for (let r = 0; r < n; r++) { const i = r * n + solution[r]; if (cells[i] === MARK) return { kind: 'wrongMark', text: t('hintWrongMark'), targets: [i], fix: [[i, EMPTY]] }; }
    const s = LG.newState(geom);
    cells.forEach((v, i) => { if (v === MARK) s.cand[i] = 0; });
    cells.forEach((v, i) => { if (v === CAT) LG.placeCat(geom, s, i); });
    const step = LG.nextStep(geom, s);
    if (!step) return { kind: 'done', text: t('hintDone'), targets: [], fix: [] };
    // If the step relies on cells that are blocked by a cat but not yet marked,
    // explain those first: otherwise "only one free spot" looks wrong.
    const blocked = blockedSet();
    const hidden = [...new Set([...(step.focus || []), ...(step.unit ? step.unit.cells : [])])].filter(i => cells[i] === EMPTY && blocked[i] && i !== step.place);
    if (hidden.length && !settings.autoX) {
      const cats = cells.map((v, i) => v === CAT && hidden.some(j => geom.attacks[i].includes(j)) ? i : -1).filter(i => i >= 0);
      return { kind: 'step', text: t('hBlocked'), focus: cats, targets: hidden, fix: hidden.map(i => [i, MARK]) };
    }
    const fix = step.place != null ? [[step.place, CAT]] : step.eliminate.filter(i => cells[i] === EMPTY).map(i => [i, MARK]);
    let focus = step.focus || [];
    if (step.tech === 'confine' && step.target) {
      const tgt = step.target;
      const line = tgt.kind === 'row' ? geom.rows[tgt.index] : tgt.kind === 'col' ? geom.cols[tgt.index] : geom.regs[tgt.index];
      focus = [...new Set([...focus, ...line])];
    }
    if (step.tech === 'subset') focus = [...new Set([...focus, ...step.eliminate])];
    return { kind: 'step', step, text: describe(step), focus, targets: step.place != null ? [] : step.eliminate, place: step.place, fix };
  }
  function showHint(h, counts = true) {
    if (!h) return;
    hint = h;
    if (counts) { hintsUsed++; A.play('hint'); if (M && M.running) { M.timeLeft -= MAR.hintCost; floatText('−20 s', true); } }
    $('hintText').textContent = h.text;
    $('hintBox').hidden = false;
    $('hintApply').hidden = !h.fix.length;
    setMood('think');
    mascot.querySelector('.pupils').style.transform = 'translate(3px,1px)';
    if (h.kind === 'wrongCat' || h.kind === 'wrongMark') h.targets.forEach(i => { const el = els[i]; el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); });
    update();
  }
  function clearHint() {
    hint = null;
    if (mood === 'think') setMood(baseMood());
    $('hintBox').hidden = true;
    if (P) $('board').classList.remove('hinting');
  }
  function applyHint() {
    if (!hint || !canPlay()) return;
    const fix = hint.fix;
    batch = []; startClock();
    fix.forEach(([i, v]) => setCell(i, v));
    if (fix.some(([, v]) => v === CAT)) A.play('cat'); else A.play('mark');
    hint = null; $('hintBox').hidden = true;
    commit();
    if (coachActive()) setTimeout(() => !won && showHint(computeHint(), false), 120);
  }
  $('hint').addEventListener('click', () => { if (canPlay()) showHint(computeHint(), !coachActive()); });
  $('hintApply').addEventListener('click', applyHint);
  $('hintClose').addEventListener('click', () => { clearHint(); update(); });

  // ---------- timer ----------
  function currentElapsed() { return elapsed + (ticking ? performance.now() - startTime : 0); }
  function fmt(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(sec);
  }
  setInterval(() => {
    if (M && M.running) marathonTick();
    else if (P) $('timer').textContent = fmt(currentElapsed());
    const cd = $('winCountdown');
    if (!cd.hidden) {
      const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const s = Math.max(0, Math.floor((next - now) / 1000));
      cd.textContent = t('nextDaily', { t: `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` });
    }
  }, 250);

  // ---------- win ----------
  function finish() {
    elapsed = currentElapsed(); ticking = false; won = true;
    clearHint();
    if (meta.kind === 'marathon') { marathonSolved(); return; }
    const stars = hintsUsed === 0 ? 3 : hintsUsed <= 2 ? 2 : 1;
    lastStars = stars;
    const before = new Set(SKINS.filter(s => s.ok(progress)).map(s => s.id));
    progress.solved++;
    progress.byTier[meta.tier] = (progress.byTier[meta.tier] || 0) + 1;
    const bk = `${P.n}-${meta.tier}`;
    lastRecord = meta.kind !== 'custom' && hintsUsed === 0 && (progress.best[bk] == null || elapsed < progress.best[bk]);
    if (lastRecord) progress.best[bk] = Math.round(elapsed);
    if (meta.kind === 'level') progress.stars[meta.level] = Math.max(progress.stars[meta.level] || 0, stars);
    if (meta.kind === 'daily' && !progress.daily.done[meta.date]) {
      const d = progress.daily;
      d.done[meta.date] = true;
    }
    if (meta.kind === 'daily' && meta.date === todayKey() && progress.daily.last !== meta.date) {
      const d = progress.daily;
      d.streak = d.last === yesterdayKey() ? d.streak + 1 : d.last === meta.date ? d.streak : 1;
      d.last = meta.date;
      d.best = Math.max(d.best, d.streak);
    }
    const fresh = SKINS.filter(s => s.ok(progress) && !before.has(s.id));
    const chIdx = meta.kind === 'level' ? ACH.chapterOf(meta.level) : -1;
    const chapterNow = chIdx >= 0 && !progress.flags?.['ch' + chIdx] && ACH.chapterDone(progress, ACH.CHAPTERS[chIdx]);
    if (chapterNow) { progress.flags = progress.flags || {}; progress.flags['ch' + chIdx] = true; }
    const achNew = ACH.check(progress, { kind: meta.kind, tier: meta.tier, n: P.n, hints: hintsUsed, elapsed, date: meta.date, isToday: meta.date === todayKey(), hour: new Date().getHours() });
    saveProgress(); save();
    showWin(true);
    const notes = [];
    if (chapterNow) notes.push(t('chapterComplete', { name: t('chapters')[ACH.CHAPTERS[chIdx].id] }));
    fresh.forEach(sk => notes.push(t('unlocked', { name: t('skins')[sk.id] })));
    achNew.forEach(id => notes.push(t('achUnlocked', { name: t('ach')[id][0] })));
    notes.forEach((msg, k) => setTimeout(() => { A.play('unlock'); toast(msg); }, 1400 + k * 2600));
  }
  function award(flag) {
    progress.flags = progress.flags || {};
    progress.flags[flag] = true;
    const achNew = ACH.check(progress, null);
    saveProgress();
    achNew.forEach((id, k) => setTimeout(() => { A.play('unlock'); toast(t('achUnlocked', { name: t('ach')[id][0] })); }, 300 + k * 2600));
  }
  function showWin(celebrate) {
    $('board').classList.add('won');
    setMood('happy');
    if (celebrate) setTimeout(() => say(pick(t('sayWin')), 3000, true), 300);
    ['undo', 'hint', 'pause'].forEach(id => { $(id).disabled = true; });
    els.forEach((el, i) => el.style.setProperty('--i', String(i % P.n + ((i / P.n) | 0))));
    renderWinText();
    $('shareMsg').textContent = '';
    $('timer').textContent = fmt(elapsed);
    const next = $('winNext');
    if (meta.kind === 'level') { next.hidden = meta.level >= LEVELS.length; next.textContent = t('nextLevel'); }
    else if (meta.kind === 'daily') { next.hidden = false; next.textContent = t('playFree'); }
    else if (meta.kind === 'custom') { next.hidden = false; next.textContent = t('wsEdit'); }
    else { next.hidden = false; next.textContent = t('next'); }
    if (celebrate) { A.play('win'); confetti(); }
    setTimeout(() => { if (won) $('win').hidden = false; }, celebrate ? 900 : 0);
    renderModebar();
  }
  function renderWinText() {
    if (!P || !meta) return;
    const k = hintsUsed;
    $('winText').textContent = t('winIn', { size: `${P.n}×${P.n}`, tier: t('tier' + meta.tier), t: fmt(elapsed) }) + '. ' + (k === 0 ? t('winNoHints') : k === 1 ? t('winHints1') : t('winHintsN', { k }));
    const extra = [];
    if (lastRecord) extra.push(t('winRecord'));
    if (meta.kind === 'daily' && meta.date === todayKey()) { const s = progress.daily.streak; extra.push(t('streakLine', { k: s, k1: s === 1 ? t('day1') : t('dayN') })); }
    $('winExtra').textContent = extra.join(' · ');
    $('winCountdown').hidden = !(meta.kind === 'daily' && meta.date === todayKey());
    $('winStars').innerHTML = meta.kind === 'level' ? [1, 2, 3].map(s => `<svg class="${s <= lastStars ? 'on' : ''}"><use href="#i-star"/></svg>`).join('') : '';
  }
  $('win').addEventListener('click', e => { if (e.target === $('win')) $('win').hidden = true; });
  $('winNext').addEventListener('click', () => {
    if (meta.kind === 'custom') { openEditor({ n: P.n, regions: P.regions }); return; }
    if (meta.kind === 'level') loadMode('journey', { level: meta.level + 1 });
    else loadMode('free', { fresh: true });
  });
  $('share').addEventListener('click', async () => {
    const title = meta.kind === 'daily' ? t('shareDaily', { date: meta.date }) : meta.kind === 'level' ? t('shareLevel', { k: meta.level }) : meta.kind === 'custom' ? `${t('title')} · ${t('customName')}` : t('shareFree', { id: `${P.n}-${meta.tier}-${free.seed}` });
    const stars = meta.kind === 'level' ? '⭐'.repeat(lastStars) + ' · ' : '';
    const streak = meta.kind === 'daily' ? ` · 🔥${progress.daily.streak}` : '';
    const link = SITE + '#' + (meta.kind === 'daily' && meta.date === todayKey() ? 'daily' : meta.id);
    const text = `${title}\n${stars}${P.n}×${P.n} ${t('tier' + meta.tier)} · ⏱ ${fmt(elapsed)} · 💡${hintsUsed}${streak}\n${'🐱'.repeat(P.n)}\n${link}`;
    try { await navigator.clipboard.writeText(text); $('shareMsg').textContent = t('copied'); }
    catch { $('shareMsg').textContent = t('copyFail'); }
  });
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    let html = '';
    for (let k = 0; k < 46; k++) {
      html += `<i style="left:${Math.random() * 100}%;--c:var(--r${k % 10});--d:${1.6 + Math.random() * 1.6}s;--r:${Math.random() * 360}deg;animation-delay:${Math.random() * 0.5}s"></i>`;
    }
    box.innerHTML = html;
    $('frame').appendChild(box);
    setTimeout(() => box.remove(), 4000);
  }
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3300);
  }

  // ---------- header / mode bar ----------
  function renderTabs() {
    document.querySelectorAll('.tabs [data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  }
  function renderName() {
    if (!meta) return;
    $('puzzleName').textContent = meta.kind === 'daily' ? t('dailyName', { date: meta.date }) : meta.kind === 'level' ? t('levelName', { k: meta.level, total: LEVELS.length }) : meta.kind === 'custom' ? t('customName') : meta.kind === 'marathon' ? `${t('marathon')} · #${(M?.k || 0) + 1}` : t('freeName', { id: `${P.n}-${meta.tier}-${free.seed}` });
    const b = $('tierBadge');
    b.className = 'badge t' + meta.tier;
    b.textContent = `${t('tier' + meta.tier)} · ${P.n}×${P.n}`;
  }
  const starIcons = k => [1, 2, 3].map(s => `<svg class="${s <= k ? 'on' : ''}"><use href="#i-star"/></svg>`).join('');
  function renderModebar() {
    const mb = $('modebar');
    if (mode === 'daily') {
      const key = dailyDate || todayKey();
      const [n, tier] = dailyPlan(key);
      const d = progress.daily;
      const streak = d.last === todayKey() || d.last === yesterdayKey() ? d.streak : 0;
      const isToday = key === todayKey();
      mb.innerHTML = `<div class="dayInfo"><span>${longDate(key)}</span><span class="badge t${tier}">${t('tier' + tier)} · ${n}×${n}</span>${streak ? `<span class="streak" title="${t('statsStreak')}"><svg><use href="#i-flame"/></svg>${streak}</span>` : ''}${d.done[key] ? '<span class="streak">✓</span>' : ''}</div>
        <span class="grow"></span>${isToday ? '' : `<button class="pill" id="dToday" type="button">${t('today')}</button>`}<button class="pill" id="dArchive" type="button"><svg class="ico"><use href="#i-cal"/></svg>${t('archive')}</button>`;
      $('dArchive').onclick = () => openArchive(key);
      if (!isToday) $('dToday').onclick = () => loadDaily();
    } else if (mode === 'workshop') {
      if (editing) {
        mb.innerHTML = `<div class="seg" role="group" aria-label="${t('sizesLabel')}">${[5, 6, 7, 8, 9, 10].map(s => `<button type="button" data-n="${s}" aria-pressed="${ed.n === s}">${s}</button>`).join('')}</div>
          <span class="grow"></span><button class="pill" id="wsRand" type="button">${t('wsRandom')}</button><button class="pill" id="wsClr" type="button">${t('wsClear')}</button>`;
        mb.querySelectorAll('[data-n]').forEach(b => b.onclick = () => setEditSize(+b.dataset.n));
        $('wsRand').onclick = randomEdit;
        $('wsClr').onclick = () => setEditSize(ed.n);
      } else {
        mb.innerHTML = `<div class="dayInfo"><span>${t('wsFriend', { n: P ? P.n : 0 })}</span>${meta ? `<span class="badge t${meta.tier}">${t('tier' + meta.tier)}</span>` : ''}</div><span class="grow"></span><button class="pill" id="wsBack" type="button">${t('wsEdit')}</button>`;
        $('wsBack').onclick = () => openEditor(P ? { n: P.n, regions: P.regions } : null);
      }
    } else if (mode === 'journey') {
      const k = meta?.kind === 'level' ? meta.level : store.get('level', 1);
      const st = progress.stars[k] || 0;
      mb.innerHTML = `<button class="navBtn" id="lvPrev" type="button" aria-label="${t('prev')}"${k <= 1 ? ' disabled' : ''}><svg><use href="#i-left"/></svg></button>
        <button class="pill lvlBtn" id="lvOpen" type="button"><span class="lvlMain">${t('levelName', { k, total: LEVELS.length })} <span class="lvlStars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span></span><small class="lvlCh">${t('chapters')[ACH.CHAPTERS[ACH.chapterOf(k)].id]}</small></button>
        <button class="navBtn" id="lvNext" type="button" aria-label="${t('nextLevel')}"${k >= LEVELS.length || !levelOpen(k + 1) ? ' disabled' : ''}><svg><use href="#i-right"/></svg></button>`;
      $('lvPrev').onclick = () => loadLevel(k - 1);
      $('lvNext').onclick = () => loadLevel(k + 1);
      $('lvOpen').onclick = openLevels;
    } else if (M) {
      mb.innerHTML = `<div class="marStats"><span>${t('marScore')} <b id="marScore">${M.score || 0}</b></span><span>${t('marSolved')} <b id="marSolved">${M.solved || 0}</b></span></div>
        <span class="grow"></span>${M.running ? `<button class="pill" id="marSkipBtn" type="button">${t('marSkip')}</button>` : ''}<button class="pill" id="marQuitBtn" type="button">${t('marQuit')}</button>`;
      if (M.running) $('marSkipBtn').onclick = skipMarathon;
      $('marQuitBtn').onclick = () => quitMarathon(false);
    } else {
      const sizes = [5, 6, 7, 8, 9, 10];
      mb.innerHTML = `<button class="pill primary" id="marBtn" type="button"><svg class="ico"><use href="#i-clock"/></svg>${t('marathon')}</button><div class="seg" role="group" aria-label="${t('tierLabel')}">${[0, 1, 2, 3].map(x => `<button type="button" data-tier="${x}" aria-pressed="${free.tier === x}">${t('tier' + x)}</button>`).join('')}</div>
        <div class="seg" role="group" aria-label="${t('sizesLabel')}">${sizes.map(s => `<button type="button" data-n="${s}" aria-pressed="${free.n === s}"${LG.TIER_SIZES[free.tier].includes(s) ? '' : ' disabled'}>${s}</button>`).join('')}</div>
        <span class="grow"></span><button class="pill" id="freeNew" type="button">${t('newGame')}</button>`;
      mb.querySelectorAll('[data-tier]').forEach(b => b.onclick = () => loadFree(free.n, +b.dataset.tier));
      mb.querySelectorAll('[data-n]').forEach(b => b.onclick = () => loadFree(+b.dataset.n, free.tier));
      $('freeNew').onclick = () => loadFree(free.n, free.tier);
      $('marBtn').onclick = openMarathon;
    }
  }
  document.querySelectorAll('.tabs [data-mode]').forEach(b => b.addEventListener('click', () => { if (b.dataset.mode !== mode) loadMode(b.dataset.mode); }));

  // ---------- dialogs ----------
  function openDlg(id) {
    const d = $(id);
    if (!paused && ticking) { togglePause(true); pausedByDialog = true; }
    try { d.showModal(); } catch { d.setAttribute('open', ''); }
  }
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    d.addEventListener('close', () => {
      if (d.id === 'dlgHelp') store.set('seenHelp', true);
      if (pausedByDialog && !document.querySelector('dialog[open]')) { pausedByDialog = false; if (paused) togglePause(false); }
    });
  });

  // ---------- daily archive ----------
  let archMonth = null;
  function openArchive(key) {
    const d = parseKey(key || todayKey());
    archMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    renderArchive();
    openDlg('dlgArchive');
  }
  function renderArchive() {
    const y = archMonth.getFullYear(), mo = archMonth.getMonth();
    const today = todayKey();
    const first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7; // Monday first
    let wd = '';
    try { const f = new Intl.DateTimeFormat(locale(), { weekday: 'narrow' }); for (let k = 0; k < 7; k++) wd += `<span class="wd">${f.format(new Date(2024, 0, 1 + k))}</span>`; } catch { wd = ''; }
    let html = wd + '<span></span>'.repeat(offset);
    for (let day = 1; day <= days; day++) {
      const k = dateKey(new Date(y, mo, day));
      const [n, tier] = dailyPlan(k);
      const future = k > today, done = !!progress.daily.done[k];
      html += `<button type="button" class="day t${tier}${done ? ' done' : ''}${k === today ? ' today' : ''}${k === dailyDate ? ' cur' : ''}" data-k="${k}"${future ? ' disabled' : ''} aria-label="${longDate(k)}, ${t('tier' + tier)} ${n}×${n}${done ? ' ✓' : ''}">
        <b>${day}</b>${done ? '<svg class="dc"><use href="#cat"/></svg>' : `<small>${n}×${n}</small>`}</button>`;
    }
    $('archGrid').innerHTML = html;
    let title = `${y}-${pad(mo + 1)}`;
    try { title = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(first); } catch { /* keep numeric */ }
    $('archTitle').textContent = title;
    const now = new Date();
    $('archNext').disabled = y > now.getFullYear() || (y === now.getFullYear() && mo >= now.getMonth());
    const doneThisMonth = Object.keys(progress.daily.done).filter(k => k.startsWith(`${y}-${pad(mo + 1)}`)).length;
    $('archCount').textContent = t('archDone', { k: doneThisMonth });
  }
  $('archPrev').addEventListener('click', () => { archMonth.setMonth(archMonth.getMonth() - 1); renderArchive(); });
  $('archNext').addEventListener('click', () => { archMonth.setMonth(archMonth.getMonth() + 1); renderArchive(); });
  $('archGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b || b.disabled) return;
    pausedByDialog = false;
    $('dlgArchive').close();
    loadMode('daily', { date: b.dataset.k });
  });

  function openLevels() {
    const cur = meta?.kind === 'level' ? meta.level : 0;
    $('levelGrid').innerHTML = LEVELS.map((L, i) => {
      const k = i + 1, open = levelOpen(k), st = progress.stars[k] || 0;
      const tierColor = ['r2', 'r1', 'r0', 'r4'][L.tier];
      const ch = ACH.CHAPTERS.find(c => c.from === k);
      const head = ch ? `<h3 class="chHead" style="--rc:var(--${ch.color})"><span>${t('chapterLabel', { k: ACH.CHAPTERS.indexOf(ch) + 1 })} · ${t('chapters')[ch.id]}</span><span class="chStars"><svg><use href="#i-star"/></svg>${ACH.chapterStars(progress, ch)}/30</span></h3>` : '';
      return `${head}<button type="button" class="lvl${k === cur ? ' cur' : ''}" data-k="${k}" style="--rc:var(--${tierColor})"${open ? '' : ' disabled'} aria-label="${t('levelName', { k, total: LEVELS.length })}, ${t('tier' + L.tier)}">
        ${open ? `${k}<small>${L.n}×${L.n}</small><span class="st">${starIcons(st)}</span>` : `<svg class="lkb"><use href="#i-lock"/></svg><small>${k}</small>`}</button>`;
    }).join('');
    $('levelGrid').onclick = e => {
      const b = e.target.closest('[data-k]');
      if (!b || b.disabled) return;
      $('dlgLevels').close();
      loadMode('journey', { level: +b.dataset.k });
    };
    openDlg('dlgLevels');
    $('levelGrid').querySelector('.cur')?.scrollIntoView({ block: 'center' });
  }

  let demoTok = 0;
  const DEMO = { L: null, regions: null, colors: null, board: null };
  function drawHelpBoard(solved) {
    const L = LEVELS[0], regions = [...L.r].map(Number);
    DEMO.L = L; DEMO.regions = regions; DEMO.colors = DEMO.colors || assignColors(L.n, regions);
    const host = $('helpBoard');
    host.innerHTML = '<div class="board"></div>';
    DEMO.board = buildBoard(host.firstChild, { n: L.n, regions, colors: DEMO.colors }, false);
    if (solved) {
      const sol = E.solve(L.n, regions, 1)[0];
      [...DEMO.board.children].forEach((el, i) => { if (sol[(i / L.n) | 0] === i % L.n) el.innerHTML = '<svg class="c"><use href="#cat"/></svg>'; });
    }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function runDemo() {
    const tok = ++demoTok;
    const live = () => tok === demoTok && $('dlgHelp').open;
    drawHelpBoard(false);
    const n = DEMO.L.n, cellsEl = [...DEMO.board.children];
    const g = LG.makeGeometry(n, DEMO.regions), st = LG.newState(g);
    $('demoText').textContent = t('demoStart');
    $('demoBtn').disabled = true;
    await sleep(1400);
    for (let guard = 0; guard < 40 && live(); guard++) {
      const step = LG.nextStep(g, st);
      if (!step) break;
      nameColors = DEMO.colors;
      $('demoText').textContent = describe(step);
      nameColors = null;
      const focus = new Set(step.focus || []), targets = new Set(step.place != null ? [] : step.eliminate);
      cellsEl.forEach((el, i) => { el.classList.toggle('hf', focus.has(i)); el.classList.toggle('ht', targets.has(i)); el.classList.toggle('hp', step.place === i); });
      DEMO.board.classList.add('hinting');
      await sleep(2300);
      if (!live()) return;
      const before = st.cand.slice();
      LG.apply(g, st, step);
      DEMO.board.classList.remove('hinting');
      cellsEl.forEach(el => el.classList.remove('hf', 'ht', 'hp'));
      if (step.place != null) {
        cellsEl[step.place].innerHTML = '<svg class="c"><use href="#cat"/></svg>';
        A.play('cat');
        await sleep(500);
        if (!live()) return;
        $('demoText').textContent = t('demoPlaced');
      }
      cellsEl.forEach((el, i) => { if (before[i] && !st.cand[i] && !st.cat[i]) el.innerHTML = '<svg class="x"><use href="#ex"/></svg>'; });
      await sleep(step.place != null ? 1500 : 700);
    }
    if (!live()) return;
    $('demoText').textContent = t('demoDone');
    A.play('chime', 4);
    $('demoBtn').disabled = false;
    $('demoBtn').textContent = t('demoAgain');
  }
  function openHelp() {
    demoTok++;
    drawHelpBoard(true);
    $('demoText').textContent = '';
    $('demoBtn').disabled = false;
    $('demoBtn').textContent = t('demoPlay');
    openDlg('dlgHelp');
  }
  $('demoBtn').addEventListener('click', runDemo);
  $('dlgHelp').addEventListener('close', () => { demoTok++; });
  $('btnHelp').addEventListener('click', openHelp);

  function openStats() {
    const d = progress.daily;
    const streak = d.last === todayKey() || d.last === yesterdayKey() ? d.streak : 0;
    const sizes = [5, 6, 7, 8, 9, 10];
    const anyBest = Object.keys(progress.best).length > 0;
    $('statsBody').innerHTML = `<div class="statGrid">
        <div><b>${progress.solved}</b><span>${t('statsSolved')}</span></div>
        <div><b>${streak}</b><span>${t('statsStreak')}</span></div>
        <div><b>${d.best}</b><span>${t('statsBestStreak')}</span></div>
        <div><b>${totalStars()}<small>/${LEVELS.length * 3}</small></b><span>${t('statsStars')}</span></div>
      </div>
      <h3>${t('statsBest')}</h3>
      ${anyBest ? `<div class="scroll"><table><thead><tr><th>${t('recBoard')}</th>${[0, 1, 2, 3].map(x => `<th>${t('tier' + x)}</th>`).join('')}</tr></thead><tbody>
        ${sizes.map(n => `<tr><td>${n}×${n}</td>${[0, 1, 2, 3].map(x => { const v = progress.best[`${n}-${x}`]; return `<td>${v != null ? fmt(v) : (LG.TIER_SIZES[x].includes(n) ? '—' : '')}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>` : `<p class="small">${t('statsNone')}</p>`}
      <h3>${t('achievements')} <span class="small">${t('achCount', { k: Object.keys(progress.ach || {}).length, total: ACH.ACHIEVEMENTS.length })}</span></h3>
      <div class="achGrid">${ACH.ACHIEVEMENTS.map(a => { const got = !!(progress.ach || {})[a.id]; const [name, desc] = t('ach')[a.id]; return `<div class="ach${got ? ' got' : ''}"><svg><use href="#i-trophy"/></svg><div><b>${name}</b><span>${desc}</span></div></div>`; }).join('')}</div>`;
    openDlg('dlgStats');
  }
  $('btnStats').addEventListener('click', openStats);

  function renderSettings() {
    $('optSound').checked = settings.sound;
    $('optMusic').checked = settings.music;
    $('optAutoX').checked = settings.autoX;
    $('optErr').checked = settings.showErr;
    $('optCb').checked = settings.cb;
    $('optCoach').checked = settings.coach;
    $('optTimer').checked = settings.hideTimer;
    document.querySelectorAll('#langSeg [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === I.lang)));
    $('skins').innerHTML = SKINS.map(s => {
      const ok = s.ok(progress);
      return `<button type="button" class="skin skin-${s.id}" data-skin="${s.id}" aria-pressed="${settings.skin === s.id}"${ok ? '' : ' disabled'}>
        <svg class="face" aria-hidden="true"><use href="#cat"/></svg>${t('skins')[s.id]}<small>${ok ? '' : t('skinReq')[s.id]}</small>${ok ? '' : '<svg class="lk"><use href="#i-lock"/></svg>'}</button>`;
    }).join('');
  }
  $('btnSettings').addEventListener('click', () => { renderSettings(); $('resetMsg').textContent = ''; resetArmed = false; $('resetAll').textContent = t('resetProgress'); openDlg('dlgSettings'); });
  const bindOpt = (id, key, after) => $(id).addEventListener('change', e => { settings[key] = e.target.checked; saveSettings(); after && after(); });
  bindOpt('optSound', 'sound', () => { A.enabled = settings.sound; if (settings.sound) A.play('meow'); });
  bindOpt('optMusic', 'music', () => { if (settings.music) MU.start(); else MU.stop(); });
  bindOpt('optAutoX', 'autoX', update);
  bindOpt('optErr', 'showErr', update);
  bindOpt('optCb', 'cb', applyLook);
  bindOpt('optTimer', 'hideTimer', applyLook);
  bindOpt('optCoach', 'coach', () => { if (coachActive() && !hint) showHint(computeHint(), false); else if (!coachActive()) { clearHint(); update(); } });
  $('langSeg').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) { setLang(b.dataset.lang); renderSettings(); } });
  $('skins').addEventListener('click', e => {
    const b = e.target.closest('[data-skin]');
    if (!b || b.disabled) return;
    settings.skin = b.dataset.skin; saveSettings(); applyLook(); renderSettings(); A.play('meow', 1 + Math.random() * 0.2);
  });
  let resetArmed = false;
  $('resetAll').addEventListener('click', () => {
    if (!resetArmed) { resetArmed = true; $('resetAll').textContent = t('resetConfirm'); return; }
    store.clear();
    settings = Object.assign(defaultSettings(), { sound: settings.sound });
    progress = defaultProgress();
    saveSettings(); saveProgress();
    resetArmed = false; $('resetAll').textContent = t('resetProgress');
    $('resetMsg').textContent = t('resetDone');
    applyLook(); renderSettings();
    loadMode(mode);
  });

  function applyLook() {
    const skin = SKINS.find(s => s.id === settings.skin && s.ok(progress)) ? settings.skin : 'ginger';
    document.body.className = 'skin-' + skin + (settings.cb ? ' cb' : '') + (settings.hideTimer ? ' noTimer' : '');
    A.enabled = settings.sound;
  }

  // ---------- language ----------
  function setLang(v) {
    I.lang = v;
    store.set('lang', v);
    I.apply(document);
    $('lang').textContent = t('langSwitch');
    $('lang').setAttribute('aria-label', t('langSwitchLabel'));
    $('pause').textContent = t(paused ? 'resume' : 'pause');
    renderName(); renderModebar();
    if (editing) { renderPalette(); validateEditor(); }
    if (M && M.running) $('timerLabel').textContent = t('timeLeft');
    if (won) { renderWinText(); showWinButtons(); }
    if (hint) { const h = computeHint(); if (h) { hint = h; $('hintText').textContent = h.text; } }
    if (P) update();
  }
  function showWinButtons() {
    const next = $('winNext');
    next.textContent = meta.kind === 'level' ? t('nextLevel') : meta.kind === 'daily' ? t('playFree') : meta.kind === 'custom' ? t('wsEdit') : t('next');
  }
  $('lang').addEventListener('click', () => setLang(I.lang === 'ro' ? 'en' : 'ro'));

  // ---------- keyboard shortcuts ----------
  document.addEventListener('keydown', e => {
    if (editing || document.querySelector('dialog[open]') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase();
    if ((k === 'z' && e.shiftKey) || (k === 'y' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); redo(); }
    else if (k === 'z' && !e.altKey) { e.preventDefault(); undo(); }
    else if (k === 'h' && !e.ctrlKey && !e.metaKey) { if (canPlay()) showHint(computeHint(), !coachActive()); }
    else if (k === 'p' && !e.ctrlKey && !e.metaKey) togglePause();
    else if (k === 'escape' && hint) { clearHint(); update(); }
  });

  // ---------- share image ----------
  function resolveColor(v) {
    const d = document.createElement('div');
    d.style.color = v; d.style.display = 'none';
    document.body.appendChild(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  }
  function catImage() {
    const cs = getComputedStyle(document.body);
    let body = $('cat').innerHTML;
    for (let k = 0; k < 4 && body.includes('var('); k++) {
      body = body.replace(/var\((--[\w-]+)(?:,([^()]*))?\)/g, (m, name, fb) => cs.getPropertyValue(name).trim() || (fb ? fb.trim() : 'none'));
    }
    const defs = $('galaxyFur').outerHTML;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${defs}</defs>${body}</svg>`;
    return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  async function makeShareImage() {
    if (!P || !meta) return null;
    try { await document.fonts.ready; } catch { /* fonts optional */ }
    const W = 1080, H = 1350, n = P.n;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const col = name => resolveColor(`var(${name})`);
    const bg = col('--bg'), bg2 = col('--bg2'), ink = col('--ink'), soft = col('--soft'), line = col('--line'), accent = col('--accent'), gold = col('--gold'), card = col('--card');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(80, 40, 300, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W + 40, H + 20, 330, 0, Math.PI * 2); ctx.fill();
    const cat = await catImage();
    if (cat) ctx.drawImage(cat, 90, 64, 130, 130);
    const head = 'Fredoka, Nunito, system-ui, sans-serif', bodyF = 'Nunito, system-ui, sans-serif';
    ctx.fillStyle = ink; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 92px ${head}`; ctx.fillText(t('title'), 240, 150);
    const sub = meta.kind === 'daily' ? t('dailyName', { date: longDate(meta.date) }) : meta.kind === 'level' ? `${t('levelName', { k: meta.level, total: LEVELS.length })} · ${t('chapters')[ACH.CHAPTERS[ACH.chapterOf(meta.level)].id]}` : meta.kind === 'custom' ? t('customName') : t('modeFree');
    ctx.fillStyle = soft; ctx.font = `700 36px ${bodyF}`; ctx.fillText(sub, 244, 200);
    // board
    const B = 860, bx = (W - B) / 2, by = 250, pad = 18, inner = B - pad * 2, cell = inner / n;
    ctx.fillStyle = 'rgba(0,0,0,.14)'; rrect(ctx, bx, by + 16, B, B, 40); ctx.fill();
    ctx.fillStyle = line; rrect(ctx, bx, by, B, B, 40); ctx.fill();
    ctx.save(); rrect(ctx, bx + pad, by + pad, inner, inner, 26); ctx.clip();
    const regionCol = [...Array(10).keys()].map(k => col('--r' + k));
    for (let i = 0; i < n * n; i++) {
      const r = (i / n) | 0, c = i % n;
      ctx.fillStyle = regionCol[P.colors ? P.colors[P.regions[i]] : P.regions[i]];
      ctx.fillRect(bx + pad + c * cell, by + pad + r * cell, cell + 0.6, cell + 0.6);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1.5;
    for (let k = 1; k < n; k++) {
      ctx.beginPath(); ctx.moveTo(bx + pad + k * cell, by + pad); ctx.lineTo(bx + pad + k * cell, by + pad + inner); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + pad, by + pad + k * cell); ctx.lineTo(bx + pad + inner, by + pad + k * cell); ctx.stroke();
    }
    ctx.strokeStyle = line; ctx.lineWidth = n >= 9 ? 6 : 7; ctx.lineCap = 'round';
    for (let i = 0; i < n * n; i++) {
      const r = (i / n) | 0, c = i % n, x = bx + pad + c * cell, y = by + pad + r * cell, g = P.regions[i];
      if (c < n - 1 && P.regions[i + 1] !== g) { ctx.beginPath(); ctx.moveTo(x + cell, y); ctx.lineTo(x + cell, y + cell); ctx.stroke(); }
      if (r < n - 1 && P.regions[i + n] !== g) { ctx.beginPath(); ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y + cell); ctx.stroke(); }
    }
    if (cat) P.solution.forEach((c, r) => ctx.drawImage(cat, bx + pad + c * cell + cell * 0.1, by + pad + r * cell + cell * 0.1, cell * 0.8, cell * 0.8));
    ctx.restore();
    // stats row
    const y0 = by + B + 88;
    ctx.textAlign = 'center';
    const items = [
      [fmt(elapsed), t('time')],
      [`${n}×${n}`, t('tier' + meta.tier)],
      [hintsUsed === 0 ? '0' : String(hintsUsed), hintsUsed === 0 ? t('imgHints0') : hintsUsed === 1 ? t('imgHints1') : t('imgHints', { k: hintsUsed }).replace(/^\d+\s*/, '')]
    ];
    const colW = W / items.length;
    items.forEach(([big, small], k) => {
      const cx = colW * k + colW / 2;
      ctx.fillStyle = card; rrect(ctx, cx - colW / 2 + 40, y0 - 70, colW - 80, 140, 28); ctx.fill();
      const isStars = meta.kind === 'level' && k === 2;
      ctx.fillStyle = isStars ? gold : ink; ctx.font = `600 ${isStars ? 56 : 62}px ${head}`;
      ctx.fillText(isStars ? '★'.repeat(lastStars) + '☆'.repeat(3 - lastStars) : big, cx, y0 + 6);
      ctx.fillStyle = soft; ctx.font = `700 28px ${bodyF}`; ctx.fillText(small, cx, y0 + 46);
    });
    ctx.fillStyle = accent; ctx.font = `800 30px ${bodyF}`;
    ctx.fillText(SITE.replace(/^https:\/\//, '').replace(/\/$/, ''), W / 2, H - 28);
    ctx.textAlign = 'left';
    return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
  }
  let imgBlob = null, imgUrl = null;
  async function openImage() {
    const blob = await makeShareImage();
    if (!blob) return;
    imgBlob = blob;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    imgUrl = URL.createObjectURL(blob);
    $('shareImg').src = imgUrl;
    $('shareImg').alt = `${t('title')} · ${P.n}×${P.n}`;
    $('imgDl').href = imgUrl;
    $('imgDl').download = `catnap-${meta.id}.png`;
    const file = new File([blob], 'catnap.png', { type: 'image/png' });
    let canShare = false;
    try { canShare = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { canShare = false; }
    $('imgShare').hidden = !canShare;
    openDlg('dlgImage');
  }
  $('imgBtn').addEventListener('click', openImage);
  $('imgShare').addEventListener('click', async () => {
    if (!imgBlob) return;
    try { await navigator.share({ files: [new File([imgBlob], 'catnap.png', { type: 'image/png' })], text: SITE }); } catch { /* cancelled */ }
  });

  // ---------- marathon ----------
  const MAR = { time: 300000, bonus: 15000, hintCost: 20000, skipCost: 30000 };
  const MAR_SEQ = [[5, 0], [5, 0], [6, 0], [6, 1], [6, 1], [7, 0], [7, 1], [7, 1], [8, 1], [7, 2], [8, 1], [8, 2], [9, 1], [8, 2], [9, 2], [10, 1], [9, 2], [10, 2]];
  let M = null;
  const marPlan = k => MAR_SEQ[Math.min(k, MAR_SEQ.length - 1)];
  function marGen(k) { const [n, tier] = marPlan(k); return generate(n, tier, LG.mixSeed(M.seed, k)); }
  function floatText(txt, neg) {
    const el = document.createElement('div');
    el.className = 'floatTxt' + (neg ? ' neg' : '');
    el.textContent = txt;
    $('floatLayer').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }
  function marCard(html) { $('marCard').innerHTML = html; $('marOv').hidden = false; }
  function openMarathon() {
    if (M) return;
    M = { running: false, score: 0, solved: 0 };
    if (P && ticking) { elapsed = currentElapsed(); ticking = false; }
    const best = progress.marathon?.best || 0;
    marCard(`<svg class="marIcon"><use href="#i-clock"/></svg><h2>${t('marTitle')}</h2><p>${t('marRules')}</p>${best ? `<p class="small">${t('marBest', { k: best })}</p>` : ''}
      <div class="winBtns"><button type="button" class="primary" id="marGo">${t('marStart')}</button><button type="button" id="marNo">${t('marQuit')}</button></div>`);
    $('marGo').onclick = startMarathon;
    $('marNo').onclick = () => quitMarathon(false);
    renderModebar();
  }
  async function startMarathon() {
    M = { running: true, score: 0, solved: 0, k: 0, seed: (Math.random() * 1e9) >>> 0, timeLeft: MAR.time, last: performance.now(), loading: true };
    $('marOv').hidden = true;
    $('timerLabel').textContent = t('timeLeft');
    renderModebar();
    await marNext();
  }
  async function marNext() {
    const run = M; if (!run) return;
    run.loading = true;
    const tok = ++loadToken;
    const p = await (run.prefetch || marGen(run.k));
    if (M !== run || tok !== loadToken || !p) return;
    start(p, { kind: 'marathon', id: 'marathon', tier: p.tier });
    run.loading = false; run.last = performance.now();
    ticking = true; startTime = performance.now();
    run.prefetch = marGen(run.k + 1);
    renderModebar();
  }
  function marathonTick() {
    const now = performance.now();
    if (!paused && !M.loading) M.timeLeft -= now - M.last;
    M.last = now;
    const left = Math.max(0, M.timeLeft);
    $('timer').textContent = fmt(left + 999);
    document.querySelector('.stats').classList.toggle('low', left < 30000);
    if (left <= 0) endMarathon();
  }
  function marathonSolved() {
    const pts = P.n * P.n * (1 + meta.tier);
    M.score += pts; M.solved++; M.timeLeft += MAR.bonus;
    progress.solved++;
    progress.byTier[meta.tier] = (progress.byTier[meta.tier] || 0) + 1;
    const achNew = ACH.check(progress, { kind: 'marathon', tier: meta.tier, n: P.n, hints: hintsUsed, elapsed, hour: new Date().getHours() });
    saveProgress();
    A.play('cat'); setTimeout(() => A.play('unlock'), 120);
    floatText(`+${pts}  +15 s`);
    $('board').classList.add('won');
    els.forEach((el, i) => el.style.setProperty('--i', String(i % P.n + ((i / P.n) | 0))));
    setMood('happy', 900);
    achNew.forEach((id, k) => setTimeout(() => toast(t('achUnlocked', { name: t('ach')[id][0] })), 600 + k * 2600));
    renderModebar();
    M.k++;
    M.loading = true;
    setTimeout(() => { if (M && M.running) marNext(); }, 850);
  }
  function skipMarathon() {
    if (!M || !M.running || M.loading) return;
    M.timeLeft -= MAR.skipCost;
    floatText('−30 s', true);
    M.k++;
    marNext();
  }
  function endMarathon() {
    const run = M;
    run.running = false;
    ticking = false; won = true;
    ['undo', 'hint', 'pause'].forEach(id => { $(id).disabled = true; });
    clearHint();
    document.querySelector('.stats').classList.remove('low');
    progress.marathon = progress.marathon || { best: 0, bestSolved: 0, played: 0 };
    const pm = progress.marathon;
    pm.played++;
    const record = run.score > pm.best;
    if (record) pm.best = run.score;
    pm.bestSolved = Math.max(pm.bestSolved || 0, run.solved);
    const achNew = ACH.check(progress, null);
    saveProgress();
    A.play('win');
    if (record && run.score > 0) confetti();
    setMood('happy');
    marCard(`<svg class="marIcon"><use href="#i-clock"/></svg><h2>${t('marOver')}</h2><div class="bigScore">${run.score}</div><p>${t(run.solved === 1 ? 'marResult1' : 'marResult', { k: run.solved, s: run.score })}</p>
      <p class="winExtra">${record && run.score > 0 ? t('marNew') : t('marBest', { k: pm.best })}</p>
      <div class="winBtns"><button type="button" id="marShareBtn">${t('share')}</button><button type="button" class="primary" id="marAgain">${t('marAgain')}</button></div><p id="marMsg" class="small" aria-live="polite"></p>`);
    $('marAgain').onclick = () => { M = null; openMarathon(); };
    $('marShareBtn').onclick = async () => {
      try { await navigator.clipboard.writeText(t('marShare', { k: run.solved, s: run.score }).replace(/\\n/g, '\n') + '\n' + SITE); $('marMsg').textContent = t('copied'); }
      catch { $('marMsg').textContent = t('copyFail'); }
    };
    achNew.forEach((id, k) => setTimeout(() => { A.play('unlock'); toast(t('achUnlocked', { name: t('ach')[id][0] })); }, 1400 + k * 2600));
    renderModebar();
  }
  function quitMarathon(silent) {
    M = null;
    $('marOv').hidden = true;
    document.querySelector('.stats').classList.remove('low');
    $('timerLabel').textContent = t('time');
    if (!silent) loadFree(free.n, free.tier, free.seed);
  }

  // ---------- mascot ----------
  const mascot = $('mascot');
  let moodTimer = null, idleTimer = null, stuckTimer = null, mood = '', eyeRaf = 0;
  function baseMood() { return won ? 'happy' : paused ? 'sleep' : hint ? 'think' : ''; }
  function setMood(m, ms) {
    clearTimeout(moodTimer);
    mascot.classList.remove('happy', 'sleep', 'scared', 'think');
    if (m) mascot.classList.add(m);
    mood = m;
    if (ms) moodTimer = setTimeout(() => setMood(baseMood()), ms);
  }
  function poke() {
    clearTimeout(idleTimer);
    if (mood === 'sleep' && !paused) setMood(baseMood());
    clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => { if (P && !won && !editing && !hint && !paused && ticking) sayFrom('sayStuck'); }, 45000);
    idleTimer = setTimeout(() => { if (P && !won && !editing && !hint) setMood('sleep'); }, 25000);
  }
  document.addEventListener('pointermove', e => {
    poke();
    if (eyeRaf || mood === 'think') return;
    eyeRaf = requestAnimationFrame(() => {
      eyeRaf = 0;
      const r = mascot.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.7);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160) * 3.2;
      mascot.querySelector('.pupils').style.transform = `translate(${(dx / d) * k}px,${(dy / d) * k}px)`;
    });
  }, { passive: true });
  document.addEventListener('keydown', poke);
  document.addEventListener('pointerdown', poke);

  // speech bubble
  let bubbleTimer = null, lastSay = 0;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  function say(text, ms = 3200, force = false) {
    const now = Date.now();
    if (!force && now - lastSay < 2500) return;
    lastSay = now;
    const b = $('bubble');
    b.textContent = text;
    b.hidden = false;
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { b.hidden = true; }, ms);
  }
  const sayFrom = key => say(pick(t(key)));

  // petting: stroke the head to make it purr, tap it to make it meow
  const mHead = mascot.querySelector('.mHead'), mPaws = mascot.querySelector('.paws');
  let pet = null, purrTimer = null, heartTimer = 0, petCounted = false, petSaveTimer = null;
  function heart() {
    const h = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    h.innerHTML = '<use href="#i-heart"/>';
    h.style.left = `${30 + Math.random() * 50}%`;
    h.style.setProperty('--dx', `${(Math.random() - 0.5) * 50}px`);
    $('petLayer').appendChild(h);
    setTimeout(() => h.remove(), 1500);
  }
  function petMove(e) {
    if (!pet) return;
    const dx = e.clientX - pet.x, dy = e.clientY - pet.y;
    pet.dist += Math.hypot(dx, dy);
    pet.x = e.clientX; pet.y = e.clientY;
    if (pet.dist > 24) {
      if (!mascot.classList.contains('pet')) {
        if (mood === 'sleep' || mood === 'scared') setMood(won ? 'happy' : '');
        mascot.classList.add('pet');
        A.purrStart();
        if (!petCounted) {
          petCounted = true;
          progress.pets = (progress.pets || 0) + 1;
          clearTimeout(petSaveTimer);
          petSaveTimer = setTimeout(() => {
            const got = ACH.check(progress, null); saveProgress();
            got.forEach((id, k) => setTimeout(() => { A.play('unlock'); toast(t('achUnlocked', { name: t('ach')[id][0] })); }, k * 2600));
          }, 800);
          if (Math.random() < 0.6) sayFrom('sayPet');
        }
      }
      mascot.style.setProperty('--tilt', `${Math.max(-10, Math.min(10, dx * 1.5))}deg`);
      const now = performance.now();
      if (now - heartTimer > 320) { heartTimer = now; heart(); }
      clearTimeout(purrTimer);
      purrTimer = setTimeout(endPet, 700);
    }
  }
  function endPet() {
    mascot.classList.remove('pet');
    mascot.style.removeProperty('--tilt');
    A.purrStop();
    petCounted = false;
  }
  function petDown(e) {
    e.preventDefault(); e.stopPropagation();
    pet = { x: e.clientX, y: e.clientY, dist: 0, t: performance.now(), pointer: e.pointerId };
    try { mascot.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function petUp(e) {
    if (!pet) return;
    const quick = pet.dist < 12 && performance.now() - pet.t < 400;
    pet = null;
    if (quick) {
      A.play('meow', 0.9 + Math.random() * 0.35);
      mascot.classList.remove('hop'); void mascot.getBoundingClientRect(); mascot.classList.add('hop');
      setTimeout(() => mascot.classList.remove('hop'), 500);
      if (mood === 'sleep') setMood(baseMood());
      say(Math.random() < 0.55 ? `${t('sayFactIntro')} ${pick(t('sayFacts'))}` : pick(t('sayPet')), 4200, true);
    }
  }
  [mHead, mPaws].forEach(el => el.addEventListener('pointerdown', petDown));
  mascot.addEventListener('pointermove', petMove);
  // mouse users can pet just by hovering and moving over the head
  [mHead, mPaws].forEach(el => el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && !pet) pet = { x: e.clientX, y: e.clientY, dist: 0, t: performance.now(), hover: true }; }));
  [mHead, mPaws].forEach(el => el.addEventListener('pointerleave', () => { if (pet && pet.hover) pet = null; }));
  mascot.addEventListener('pointerup', petUp);
  mascot.addEventListener('pointercancel', () => { pet = null; });

  // ---------- boot ----------
  if (ACH.check(progress, null).length) saveProgress();
  applyLook();
  setLang(I.detect(store.get('lang', null)));
  function route(h, fallback) {
    let m;
    if (h === 'daily') loadMode('daily');
    else if ((m = /^daily-(\d{4}-\d\d-\d\d)$/.exec(h))) loadMode('daily', { date: m[1] });
    else if ((m = /^level-(\d+)$/.exec(h)) && levelOpen(+m[1])) loadMode('journey', { level: +m[1] });
    else if ((m = /^f-(\d+)-(\d)-(\d+)$/.exec(h))) loadMode('free', { n: +m[1], tier: +m[2], seed: +m[3] });
    else if ((m = /^c-(\d+)-(\d+)$/.exec(h)) && +m[1] >= 5 && +m[1] <= 10 && m[2].length === (+m[1]) ** 2 && [...m[2]].every(d => +d < +m[1])) loadMode('workshop', { custom: { n: +m[1], regions: [...m[2]].map(Number) } });
    else if (h === 'workshop') loadMode('workshop');
    else if (fallback) loadMode(mode);
  }
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if ((h === 'workshop' && editing) || (meta && (h === meta.id || (h === 'daily' && meta.kind === 'daily' && meta.date === todayKey())))) return;
    route(h, false);
  });
  route(location.hash.slice(1), true);
  if (!store.get('seenHelp', false)) setTimeout(openHelp, 400);
  else setTimeout(() => say(pick(t('sayHello')) + ' ' + t('petHint'), 3600, true), 1200);

  if ('serviceWorker' in navigator && /^https:$/.test(location.protocol) && /github\.io$/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  }
}
