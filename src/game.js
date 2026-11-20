// Mustăți — game UI
{
  const E = window.MustatiEngine;
  const L = window.MustatiI18n;
  const t = L.t;
  const $ = id => document.getElementById(id);
  const EMPTY = 0, MARK = 1, CAT = 2;
  const SIZES = [5, 6, 7, 8, 9, 10];
  const REGION_EMOJI = ['🟥', '🟨', '🟩', '🟦', '🟪', '🟧', '🟫', '⬜', '⬛', '🔶'];

  const store = {
    get(k, d) { try { const v = localStorage.getItem('mustati:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('mustati:' + k, JSON.stringify(v)); } catch { /* storage off */ } }
  };

  let P = null;            // puzzle {n, regions, solution, seed}
  let cells = [];          // state per cell
  let history = [];        // undo stack of batches [{i, prev}]
  let batch = null;
  let startTime = 0, elapsed = 0, ticking = false, won = false, hintsUsed = 0;
  let isDaily = false;
  let size = store.get('size', 8);
  let els = [];

  const settings = { autoX: store.get('autoX', false), showErr: store.get('showErr', true) };
  $('autoX').checked = settings.autoX;
  $('showErr').checked = settings.showErr;

  // ---------- puzzle selection ----------
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function loadPuzzle(n, seed, daily) {
    const p = E.generate(n, seed);
    if (!p) return loadPuzzle(n, (seed * 31 + 7) >>> 0, daily);
    P = p; isDaily = daily; size = n;
    cells = new Array(n * n).fill(EMPTY);
    history = []; won = false; hintsUsed = 0;
    elapsed = 0; ticking = false;
    const key = daily ? 'daily-' + todayKey() : `p${n}-${seed}`;
    const saved = store.get('save:' + key, null);
    if (saved && saved.cells && saved.cells.length === n * n) {
      cells = saved.cells; elapsed = saved.elapsed || 0; hintsUsed = saved.hints || 0; won = !!saved.won;
    }
    P.key = key;
    try { window.history.replaceState(null, '', daily ? '#zilnic' : `#p${n}-${seed}`); } catch { /* sandboxed */ }
    buildBoard();
    renderModes();
    renderName();
    $('hintMsg').textContent = '';
    $('win').hidden = true;
    if (won) showWin(false);
    update();
  }
  function newRandom(n) { loadPuzzle(n, (Math.random() * 1e6) | 0, false); }
  function loadDaily() { loadPuzzle(8, E.hashString('mustati-' + todayKey()), true); }

  function renderModes() {
    $('sizes').innerHTML = SIZES.map(s => `<button type="button" data-size="${s}" aria-pressed="${!isDaily && s === size}">${s}×${s}</button>`).join('');
    $('daily').setAttribute('aria-pressed', String(isDaily));
  }

  // ---------- board ----------
  function buildBoard() {
    const { n, regions } = P;
    const board = $('board');
    board.style.gridTemplateColumns = `repeat(${n}, minmax(0,1fr))`;
    board.style.gridTemplateRows = `repeat(${n}, minmax(0,1fr))`;
    board.classList.remove('won');
    const thick = n >= 9 ? '2.5px' : '3px';
    let html = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c, g = regions[i];
      const diff = (rr, cc) => rr < 0 || cc < 0 || rr >= n || cc >= n ? false : regions[rr * n + cc] !== g;
      const bt = diff(r - 1, c) ? thick : '0px', bb = diff(r + 1, c) ? thick : '0px';
      const bl = diff(r, c - 1) ? thick : '0px', br = diff(r, c + 1) ? thick : '0px';
      html += `<button class="cell" type="button" role="gridcell" data-i="${i}" aria-label="${t('cell', { r: r + 1, c: c + 1 })}" style="--rc:var(--r${g});--bt:${bt};--bb:${bb};--bl:${bl};--br:${br}"></button>`;
    }
    board.innerHTML = html;
    els = [...board.children];
  }

  function blockedSet() {
    const { n, regions } = P;
    const blocked = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      if (cells[i] !== CAT) continue;
      const r = (i / n) | 0, c = i % n, g = regions[i];
      for (let j = 0; j < n * n; j++) {
        if (j === i) continue;
        const rr = (j / n) | 0, cc = j % n;
        if (rr === r || cc === c || regions[j] === g || (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)) blocked[j] = 1;
      }
    }
    return blocked;
  }

  function conflicts() {
    const { n, regions } = P;
    const bad = new Set();
    const cats = [];
    cells.forEach((s, i) => { if (s === CAT) cats.push(i); });
    for (let a = 0; a < cats.length; a++) for (let b = a + 1; b < cats.length; b++) {
      const i = cats[a], j = cats[b];
      const r1 = (i / n) | 0, c1 = i % n, r2 = (j / n) | 0, c2 = j % n;
      if (r1 === r2 || c1 === c2 || regions[i] === regions[j] || (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1)) { bad.add(i); bad.add(j); }
    }
    return { bad, count: cats.length };
  }

  function update() {
    const { n } = P;
    const { bad, count } = conflicts();
    const blocked = settings.autoX ? blockedSet() : null;
    els.forEach((el, i) => {
      const s = cells[i];
      const want = s === CAT ? 'cat' : s === MARK ? 'x' : blocked && blocked[i] ? 'auto' : '';
      if (el.dataset.v !== want) {
        el.dataset.v = want;
        el.innerHTML = want === 'cat' ? `<svg class="c"><use href="#cat"/></svg>`
          : want === 'x' ? `<svg class="x"><use href="#ex"/></svg>`
          : want === 'auto' ? `<svg class="x auto"><use href="#ex"/></svg>` : '';
      }
      el.classList.toggle('bad', settings.showErr && bad.has(i));
      el.setAttribute('aria-label', t('cell', { r: ((i / n) | 0) + 1, c: i % n + 1 }) + (s === CAT ? t('cellCat') : s === MARK ? t('cellMark') : ''));
    });
    $('catCount').textContent = `${count}/${n}`;
    $('undo').disabled = !history.length || won;
    if (!won && count === n && bad.size === 0) finish();
    save();
  }

  function save() {
    if (!P) return;
    store.set('save:' + P.key, { cells, elapsed: currentElapsed(), hints: hintsUsed, won });
  }

  // ---------- input ----------
  let drag = null; // {mode: MARK|EMPTY|null, seen:Set}
  function setCell(i, v) {
    if (cells[i] === v) return;
    batch.push({ i, prev: cells[i] });
    cells[i] = v;
  }
  function startClock() {
    if (!ticking && !won) { ticking = true; startTime = performance.now(); }
  }
  const board = $('board');
  board.addEventListener('pointerdown', e => {
    const el = e.target.closest('.cell');
    if (!el || won) return;
    e.preventDefault();
    const i = +el.dataset.i;
    batch = [];
    startClock();
    if (e.button === 2) { setCell(i, cells[i] === CAT ? EMPTY : CAT); drag = null; }
    else {
      const next = cells[i] === EMPTY ? MARK : cells[i] === MARK ? CAT : EMPTY;
      setCell(i, next);
      drag = next === MARK ? { mode: MARK, seen: new Set([i]) } : next === EMPTY ? { mode: EMPTY, seen: new Set([i]) } : null;
    }
    $('hintMsg').textContent = '';
    update();
  });
  board.addEventListener('pointermove', e => {
    if (!drag || won) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cell');
    if (!el) return;
    const i = +el.dataset.i;
    if (drag.seen.has(i)) return;
    drag.seen.add(i);
    if (drag.mode === MARK && cells[i] === EMPTY) setCell(i, MARK);
    else if (drag.mode === EMPTY && cells[i] === MARK) setCell(i, EMPTY);
    update();
  });
  const endDrag = () => {
    if (batch && batch.length) history.push(batch);
    batch = null; drag = null;
    if (P) update();
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  board.addEventListener('contextmenu', e => e.preventDefault());
  board.addEventListener('keydown', e => {
    const el = e.target.closest('.cell');
    if (!el || !P) return;
    const n = P.n, i = +el.dataset.i;
    const moves = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 };
    if (moves[e.key] != null) {
      const j = i + moves[e.key];
      if (j >= 0 && j < n * n && !(e.key === 'ArrowLeft' && i % n === 0) && !(e.key === 'ArrowRight' && i % n === n - 1)) els[j].focus();
      e.preventDefault();
    } else if (e.key === 'x' || e.key === 'X' || e.key === 'c' || e.key === 'C' || e.key === ' ' || e.key === 'Backspace') {
      if (won) return;
      e.preventDefault();
      batch = []; startClock();
      const v = /x/i.test(e.key) ? (cells[i] === MARK ? EMPTY : MARK) : /c/i.test(e.key) ? (cells[i] === CAT ? EMPTY : CAT) : e.key === ' ' ? (cells[i] + 1) % 3 : EMPTY;
      setCell(i, v);
      endDrag();
    }
  });
  // Enter on a focused cell triggers click → handled as pointerdown for mouse; keyboard uses keys above.
  board.addEventListener('click', e => { if (e.detail === 0) { const el = e.target.closest('.cell'); if (el && !won) { batch = []; startClock(); const i = +el.dataset.i; setCell(i, (cells[i] + 1) % 3); endDrag(); } } });

  function undo() {
    if (won || !history.length) return;
    const b = history.pop();
    for (let k = b.length - 1; k >= 0; k--) cells[b[k].i] = b[k].prev;
    update();
  }
  $('undo').addEventListener('click', undo);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });
  $('reset').addEventListener('click', () => {
    if (won) { won = false; $('win').hidden = true; elapsed = 0; ticking = false; $('board').classList.remove('won'); }
    batch = [];
    cells.forEach((v, i) => { if (v !== EMPTY) setCell(i, EMPTY); });
    endDrag();
  });
  $('hint').addEventListener('click', () => {
    if (won) return;
    const { n, solution } = P;
    // 1) a cat in a wrong place
    for (let i = 0; i < n * n; i++) {
      if (cells[i] === CAT && solution[(i / n) | 0] !== i % n) {
        flash(i); hintsUsed++;
        $('hintMsg').textContent = t('hintWrongCat');
        return update();
      }
    }
    // 2) an X on a cell that should be a cat
    for (let r = 0; r < n; r++) {
      const i = r * n + solution[r];
      if (cells[i] === MARK) {
        flash(i); hintsUsed++;
        $('hintMsg').textContent = t('hintWrongMark');
        return update();
      }
    }
    // 3) place one missing cat — prefer the smallest region still empty
    const sizes = new Array(n).fill(0);
    P.regions.forEach(g => sizes[g]++);
    const rows = [...Array(n).keys()].filter(r => cells[r * n + solution[r]] !== CAT)
      .sort((a, b) => sizes[P.regions[a * n + solution[a]]] - sizes[P.regions[b * n + solution[b]]]);
    if (!rows.length) return;
    const i = rows[0] * n + solution[rows[0]];
    batch = []; startClock(); setCell(i, CAT); hintsUsed++;
    $('hintMsg').textContent = t('hintPlaced');
    endDrag(); flash(i);
  });
  function flash(i) {
    const el = els[i];
    el.classList.remove('hintCell'); void el.offsetWidth; el.classList.add('hintCell');
  }

  $('autoX').addEventListener('change', e => { settings.autoX = e.target.checked; store.set('autoX', settings.autoX); update(); });
  $('showErr').addEventListener('change', e => { settings.showErr = e.target.checked; store.set('showErr', settings.showErr); update(); });
  $('sizes').addEventListener('click', e => {
    const b = e.target.closest('button[data-size]');
    if (!b) return;
    store.set('size', +b.dataset.size);
    newRandom(+b.dataset.size);
  });
  $('daily').addEventListener('click', loadDaily);
  $('newGame').addEventListener('click', () => newRandom(isDaily ? store.get('size', 8) : size));
  $('winNext').addEventListener('click', () => newRandom(isDaily ? store.get('size', 8) : size));

  // ---------- timer & win ----------
  function currentElapsed() { return elapsed + (ticking ? performance.now() - startTime : 0); }
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }
  setInterval(() => { if (P) $('timer').textContent = fmt(currentElapsed()); }, 250);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ticking) { elapsed = currentElapsed(); ticking = false; save(); }
  });

  function finish() {
    elapsed = currentElapsed(); ticking = false; won = true;
    const recs = store.get('records', {});
    const r = recs[P.n] || { best: null, solved: 0 };
    r.solved++;
    const isRecord = hintsUsed === 0 && (r.best == null || elapsed < r.best);
    if (isRecord) r.best = elapsed;
    recs[P.n] = r; store.set('records', recs);
    if (isDaily) store.set('daily-done-' + todayKey(), true);
    save();
    showWin(isRecord);
    renderRecords();
  }
  function showWin(isRecord) {
    $('board').classList.add('won');
    els.forEach((el, i) => el.style.setProperty('--i', String(i % P.n + ((i / P.n) | 0))));
    const time = fmt(elapsed);
    lastRecord = isRecord;
    renderWinText();
    $('shareMsg').textContent = '';
    $('timer').textContent = time;
    setTimeout(() => { if (won) $('win').hidden = false; }, 900);
  }
  $('share').addEventListener('click', async () => {
    const { n, regions, solution } = P;
    let grid = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) grid += solution[r] === c ? '🐱' : REGION_EMOJI[regions[r * n + c] % REGION_EMOJI.length];
      grid += '\n';
    }
    const title = isDaily ? t('shareDaily', { date: todayKey() }) : t('shareOne', { n, seed: P.seed });
    const text = `${title}\n⏱ ${fmt(elapsed)}${hintsUsed ? ` · 💡${hintsUsed}` : ''}\n${grid}`;
    try { await navigator.clipboard.writeText(text); $('shareMsg').textContent = t('copied'); }
    catch { $('shareMsg').textContent = t('copyFail'); }
  });

  function renderRecords() {
    const recs = store.get('records', {});
    $('recTable').tBodies[0].innerHTML = SIZES.map(s => {
      const r = recs[s];
      return `<tr><td>${s}×${s}</td><td>${r && r.best != null ? fmt(r.best) : '—'}</td><td>${r ? r.solved : 0}</td></tr>`;
    }).join('');
  }

  // ---------- language ----------
  let lastRecord = false;
  function renderName() {
    if (!P) return;
    $('puzzleName').textContent = isDaily ? t('dailyName', { date: todayKey(), n: P.n }) : t('puzzleName', { n: P.n, seed: P.seed });
  }
  function renderWinText() {
    if (!P) return;
    const k = hintsUsed;
    $('winText').textContent = t('winIn', { n: P.n, t: fmt(elapsed) }) + (k === 0 ? t('winNoHints') : k === 1 ? t('winHints1') : t('winHintsN', { k })) + (lastRecord ? t('winRecord') : '');
  }
  function setLang(v) {
    L.lang = v;
    store.set('lang', v);
    L.apply(document);
    $('lang').textContent = t('langSwitch');
    $('lang').setAttribute('aria-label', t('langSwitchLabel'));
    renderName();
    if (won) renderWinText();
    $('hintMsg').textContent = '';
    $('shareMsg').textContent = '';
    if (P) { els.forEach(el => { el.dataset.v = '_'; }); update(); }
  }
  $('lang').addEventListener('click', () => setLang(L.lang === 'ro' ? 'en' : 'ro'));
  setLang(L.detect(store.get('lang', null)));

  // ---------- boot ----------
  renderRecords();
  const m = /^#p(\d+)-(\d+)$/.exec(location.hash);
  if (m && SIZES.includes(+m[1])) loadPuzzle(+m[1], +m[2], false);
  else if (location.hash === '#zilnic' || !store.get('daily-done-' + todayKey(), false)) loadDaily();
  else newRandom(SIZES.includes(size) ? size : 8);
  window.addEventListener('hashchange', () => {
    const k = /^#p(\d+)-(\d+)$/.exec(location.hash);
    if (k && SIZES.includes(+k[1]) && P && P.key !== `p${k[1]}-${k[2]}`) loadPuzzle(+k[1], +k[2], false);
  });
}
