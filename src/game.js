// Catnap — game UI
{
  const E = window.CatnapEngine;
  const LG = window.CatnapLogic;
  const I = window.CatnapI18n;
  const A = window.CatnapAudio;
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
  const defaultSettings = () => ({ sound: true, autoX: false, showErr: true, cb: false, coach: false, hideTimer: false, skin: 'ginger' });
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
    cells = new Array(N).fill(EMPTY); history = []; batch = null;
    elapsed = 0; ticking = false; won = false; paused = false; hintsUsed = 0; hint = null;
    lastStars = 0; lastRecord = false;
    if (saved && saved.cells && saved.cells.length === N) {
      cells = saved.cells; elapsed = saved.elapsed || 0; hintsUsed = saved.hints || 0; won = !!saved.won;
      lastStars = saved.stars || 0;
    }
    try { window.history.replaceState(null, '', '#' + (m.kind === 'daily' ? (m.date === todayKey() ? 'daily' : m.id) : m.id)); } catch { /* sandboxed */ }
    buildBoard($('board'), P, true);
    $('win').hidden = true; $('pauseOv').hidden = true;
    clearHint();
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
      html += `<${tag} class="cell" data-i="${i}" data-l="${LETTERS[g]}" style="--rc:var(--r${p.colors ? p.colors[g] : g});--bt:${b(r - 1, c)};--bb:${b(r + 1, c)};--bl:${b(r, c - 1)};--br:${b(r, c + 1)}"></${interactive ? 'button' : 'div'}>`;
    }
    board.innerHTML = html;
    if (interactive) els = [...board.children];
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
    const blocked = settings.autoX ? blockedSet() : null;
    const hf = new Set(hint?.focus || []), ht = new Set(hint?.targets || []), hp = hint?.place;
    els.forEach((el, i) => {
      const s = cells[i];
      const want = s === CAT ? 'cat' : s === MARK ? 'x' : blocked && blocked[i] ? 'auto' : '';
      if (el.dataset.v !== want) {
        el.dataset.v = want;
        el.innerHTML = want === 'cat' ? '<svg class="c"><use href="#cat"/></svg>'
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
    $('catCount').textContent = `${count}/${n}`;
    $('undo').disabled = !history.length || won;
    $('hint').disabled = won;
    $('pause').disabled = won;
    if (!won && count === n && bad.size === 0) finish();
    save();
  }

  function save() {
    if (!meta) return;
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
  let drag = null;
  const canPlay = () => P && !won && !paused && $('loading').hidden;
  function setCell(i, v) {
    if (cells[i] === v) return;
    batch.push({ i, prev: cells[i] });
    cells[i] = v;
  }
  function startClock() { if (!ticking && !won && !paused) { ticking = true; startTime = performance.now(); } }
  function commit() {
    const changed = batch && batch.length;
    if (changed) history.push(batch);
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
    batch = []; startClock();
    let next;
    if (e.button === 2) { next = cells[i] === CAT ? EMPTY : CAT; drag = null; }
    else {
      next = cells[i] === EMPTY ? MARK : cells[i] === MARK ? CAT : EMPTY;
      drag = next === MARK ? { mode: MARK, seen: new Set([i]) } : next === EMPTY ? { mode: EMPTY, seen: new Set([i]) } : null;
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
    const v = (cells[i] + 1) % 3;
    setCell(i, v); soundFor(v, i);
    commit();
  });

  function undo() {
    if (won || paused || !history.length) return;
    const b = history.pop();
    for (let k = b.length - 1; k >= 0; k--) cells[b[k].i] = b[k].prev;
    A.play('clear');
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
    save();
  }
  $('pause').addEventListener('click', () => togglePause());
  $('resumeBtn').addEventListener('click', () => togglePause(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden && ticking && !won) togglePause(true); });

  // ---------- hints ----------
  const coachActive = () => P && !won && meta && (settings.coach || (meta.kind === 'level' && meta.level <= 2 && !progress.stars[meta.level]));
  const colorName = g => t('colors')[!editing && P && P.colors ? P.colors[g] : g];
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
    if (counts) { hintsUsed++; A.play('hint'); }
    $('hintText').textContent = h.text;
    $('hintBox').hidden = false;
    $('hintApply').hidden = !h.fix.length;
    if (h.kind === 'wrongCat' || h.kind === 'wrongMark') h.targets.forEach(i => { const el = els[i]; el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); });
    update();
  }
  function clearHint() {
    hint = null;
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
    if (P) $('timer').textContent = fmt(currentElapsed());
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
    $('puzzleName').textContent = meta.kind === 'daily' ? t('dailyName', { date: meta.date }) : meta.kind === 'level' ? t('levelName', { k: meta.level, total: LEVELS.length }) : meta.kind === 'custom' ? t('customName') : t('freeName', { id: `${P.n}-${meta.tier}-${free.seed}` });
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
    } else {
      const sizes = [5, 6, 7, 8, 9, 10];
      mb.innerHTML = `<div class="seg" role="group" aria-label="${t('tierLabel')}">${[0, 1, 2, 3].map(x => `<button type="button" data-tier="${x}" aria-pressed="${free.tier === x}">${t('tier' + x)}</button>`).join('')}</div>
        <div class="seg" role="group" aria-label="${t('sizesLabel')}">${sizes.map(s => `<button type="button" data-n="${s}" aria-pressed="${free.n === s}"${LG.TIER_SIZES[free.tier].includes(s) ? '' : ' disabled'}>${s}</button>`).join('')}</div>
        <span class="grow"></span><button class="pill primary" id="freeNew" type="button">${t('newGame')}</button>`;
      mb.querySelectorAll('[data-tier]').forEach(b => b.onclick = () => loadFree(free.n, +b.dataset.tier));
      mb.querySelectorAll('[data-n]').forEach(b => b.onclick = () => loadFree(+b.dataset.n, free.tier));
      $('freeNew').onclick = () => loadFree(free.n, free.tier);
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

  function openHelp() {
    const L = LEVELS[0], regions = [...L.r].map(Number), sol = E.solve(L.n, regions, 1)[0];
    const host = $('helpBoard');
    host.innerHTML = '<div class="board"></div>';
    const b = buildBoard(host.firstChild, { n: L.n, regions, colors: assignColors(L.n, regions) }, false);
    [...b.children].forEach((el, i) => { if (sol[(i / L.n) | 0] === i % L.n) el.innerHTML = '<svg class="c"><use href="#cat"/></svg>'; });
    openDlg('dlgHelp');
  }
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
    if (k === 'z' && (e.ctrlKey || e.metaKey || !e.altKey)) { e.preventDefault(); undo(); }
    else if (k === 'h' && !e.ctrlKey && !e.metaKey) { if (canPlay()) showHint(computeHint(), !coachActive()); }
    else if (k === 'p' && !e.ctrlKey && !e.metaKey) togglePause();
    else if (k === 'escape' && hint) { clearHint(); update(); }
  });

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

  if ('serviceWorker' in navigator && /^https:$/.test(location.protocol) && /github\.io$/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  }
}
