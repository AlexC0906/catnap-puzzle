// Catnap — human-style logic solver.
// Solves a puzzle the way a person would, one deduction at a time. Used to
// (1) guarantee puzzles need no guessing, (2) rate difficulty and
// (3) produce explained hints.
//
// Techniques, from easiest to hardest:
//   1 single      — a row / column / cushion has only one free cell left
//   2 confine     — a cushion fits in one row/column (or a row/column fits in one cushion)
//   3 blocker     — a cat on this cell would leave some row/column/cushion with no free cell
//   4 subset      — k cushions fit in k rows/columns (or k rows/columns fit in k cushions)
//   5 contradiction — trying a cat on this cell leads to a dead end a few steps later
(function (root) {
  'use strict';

  const LEVEL = { single: 1, confine: 2, blocker: 3, subset: 4, contradiction: 5 };

  function makeGeometry(n, regions) {
    const N = n * n;
    const rows = [], cols = [], regs = [];
    for (let k = 0; k < n; k++) { rows.push([]); cols.push([]); regs.push([]); }
    for (let i = 0; i < N; i++) {
      rows[(i / n) | 0].push(i);
      cols[i % n].push(i);
      regs[regions[i]].push(i);
    }
    // attack lists: cells that cannot hold a cat if cell i does
    const attacks = [];
    for (let i = 0; i < N; i++) {
      const r = (i / n) | 0, c = i % n, list = [];
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const rr = (j / n) | 0, cc = j % n;
        if (rr === r || cc === c || regions[j] === regions[i] || (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)) list.push(j);
      }
      attacks.push(list);
    }
    const units = [];
    regs.forEach((cells, k) => units.push({ kind: 'region', index: k, cells }));
    rows.forEach((cells, k) => units.push({ kind: 'row', index: k, cells }));
    cols.forEach((cells, k) => units.push({ kind: 'col', index: k, cells }));
    return { n, N, regions, rows, cols, regs, attacks, units };
  }

  function newState(g, cand, cat) {
    return {
      cand: cand ? Uint8Array.from(cand) : new Uint8Array(g.N).fill(1),
      cat: cat ? Uint8Array.from(cat) : new Uint8Array(g.N)
    };
  }
  function clone(s) { return { cand: s.cand.slice(), cat: s.cat.slice() }; }

  function unitHasCat(s, u) { for (const i of u.cells) if (s.cat[i]) return true; return false; }
  function unitCands(s, u) { const out = []; for (const i of u.cells) if (s.cand[i]) out.push(i); return out; }

  function placeCat(g, s, i) {
    s.cat[i] = 1; s.cand[i] = 0;
    for (const j of g.attacks[i]) s.cand[j] = 0;
  }

  function isSolved(g, s) { let k = 0; for (let i = 0; i < g.N; i++) k += s.cat[i]; return k === g.n; }
  function isBroken(g, s) {
    for (const u of g.units) if (!unitHasCat(s, u) && unitCands(s, u).length === 0) return u;
    return null;
  }

  // ---- individual techniques: each returns a step or null ----
  function findSingle(g, s) {
    for (const u of g.units) {
      if (unitHasCat(s, u)) continue;
      const c = unitCands(s, u);
      if (c.length === 1) return { tech: 'single', level: 1, place: c[0], unit: u, focus: u.cells };
    }
    return null;
  }

  function findConfine(g, s) {
    const n = g.n;
    // cushion inside one row / column
    for (const u of g.units) {
      if (u.kind !== 'region' || unitHasCat(s, u)) continue;
      const c = unitCands(s, u);
      if (!c.length) continue;
      for (const axis of ['row', 'col']) {
        const key = i => axis === 'row' ? (i / n) | 0 : i % n;
        const k = key(c[0]);
        if (c.every(i => key(i) === k)) {
          const line = axis === 'row' ? g.rows[k] : g.cols[k];
          const elim = line.filter(i => s.cand[i] && g.regions[i] !== u.index);
          if (elim.length) return { tech: 'confine', level: 2, eliminate: elim, unit: u, target: { kind: axis, index: k }, focus: u.cells };
        }
      }
    }
    // row / column inside one cushion
    for (const u of g.units) {
      if (u.kind === 'region' || unitHasCat(s, u)) continue;
      const c = unitCands(s, u);
      if (!c.length) continue;
      const reg = g.regions[c[0]];
      if (c.every(i => g.regions[i] === reg)) {
        const inLine = new Set(u.cells);
        const elim = g.regs[reg].filter(i => s.cand[i] && !inLine.has(i));
        if (elim.length) return { tech: 'confine', level: 2, eliminate: elim, unit: u, target: { kind: 'region', index: reg }, focus: u.cells };
      }
    }
    return null;
  }

  function findBlocker(g, s) {
    // for every free cell, check if a cat there would empty another unit
    let best = null;
    for (let i = 0; i < g.N; i++) {
      if (!s.cand[i]) continue;
      const hit = new Set(g.attacks[i]); hit.add(i);
      for (const u of g.units) {
        if (unitHasCat(s, u) || u.cells.includes(i)) continue;
        const c = unitCands(s, u);
        if (c.length && c.every(j => hit.has(j))) {
          // prefer the smallest victim unit: it reads most naturally
          if (!best || c.length < best.victimSize) best = { tech: 'blocker', level: 3, eliminate: [i], unit: u, cell: i, focus: c, victimSize: c.length };
          break;
        }
      }
      if (best && best.victimSize <= 2) break;
    }
    if (best) delete best.victimSize;
    return best;
  }

  function* combos(arr, k, start = 0, acc = []) {
    if (acc.length === k) { yield acc.slice(); return; }
    for (let i = start; i <= arr.length - (k - acc.length); i++) {
      acc.push(arr[i]);
      yield* combos(arr, k, i + 1, acc);
      acc.pop();
    }
  }

  function findSubset(g, s) {
    const n = g.n;
    const openRegs = g.units.filter(u => u.kind === 'region' && !unitHasCat(s, u));
    const openRows = g.units.filter(u => u.kind === 'row' && !unitHasCat(s, u));
    const openCols = g.units.filter(u => u.kind === 'col' && !unitHasCat(s, u));
    const lineOf = { row: i => (i / n) | 0, col: i => i % n };
    const maxK = Math.min(5, openRegs.length - 1);
    for (let k = 2; k <= maxK; k++) {
      // k cushions confined to k rows/cols
      for (const axis of ['row', 'col']) {
        for (const set of combos(openRegs, k)) {
          const lines = new Set();
          for (const u of set) for (const i of unitCands(s, u)) lines.add(lineOf[axis](i));
          if (lines.size !== k) continue;
          const regSet = new Set(set.map(u => u.index));
          const elim = [];
          for (const L of lines) for (const i of (axis === 'row' ? g.rows[L] : g.cols[L])) if (s.cand[i] && !regSet.has(g.regions[i])) elim.push(i);
          if (elim.length) return { tech: 'subset', level: 4, eliminate: elim, units: set, lines: { kind: axis, indices: [...lines].sort((a, b) => a - b) }, direction: 'regionsInLines', focus: set.flatMap(u => u.cells) };
        }
      }
      // k rows/cols confined to k cushions
      for (const [axis, open] of [['row', openRows], ['col', openCols]]) {
        for (const set of combos(open, k)) {
          const regs = new Set();
          for (const u of set) for (const i of unitCands(s, u)) regs.add(g.regions[i]);
          if (regs.size !== k) continue;
          const lineSet = new Set(set.flatMap(u => u.cells));
          const elim = [];
          for (const r of regs) for (const i of g.regs[r]) if (s.cand[i] && !lineSet.has(i)) elim.push(i);
          if (elim.length) return { tech: 'subset', level: 4, eliminate: elim, units: set, lines: { kind: 'region', indices: [...regs].sort((a, b) => a - b) }, direction: 'linesInRegions', axis, focus: [...lineSet] };
        }
      }
    }
    return null;
  }

  function apply(g, s, step) {
    if (step.place != null) placeCat(g, s, step.place);
    if (step.eliminate) for (const i of step.eliminate) s.cand[i] = 0;
  }

  // propagate with simple techniques only; returns 'solved' | 'broken' | 'stuck'
  function propagate(g, s, maxLevel) {
    for (let guard = 0; guard < 500; guard++) {
      if (isBroken(g, s)) return 'broken';
      if (isSolved(g, s)) return 'solved';
      const st = findSingle(g, s) || (maxLevel >= 2 && findConfine(g, s)) || (maxLevel >= 3 && findBlocker(g, s)) || (maxLevel >= 4 && findSubset(g, s));
      if (!st) return 'stuck';
      apply(g, s, st);
    }
    return 'stuck';
  }

  function findContradiction(g, s) {
    // try every free cell; prefer the one whose contradiction is found fastest
    for (const depthLevel of [1, 2, 3]) {
      for (let i = 0; i < g.N; i++) {
        if (!s.cand[i]) continue;
        const t = clone(s);
        placeCat(g, t, i);
        if (propagate(g, t, depthLevel) === 'broken') {
          return { tech: 'contradiction', level: 5, eliminate: [i], cell: i, depth: depthLevel, focus: [i] };
        }
      }
    }
    return null;
  }

  function nextStep(g, s, maxLevel = 5) {
    if (isSolved(g, s)) return null;
    return findSingle(g, s)
      || (maxLevel >= 2 && findConfine(g, s))
      || (maxLevel >= 3 && findBlocker(g, s))
      || (maxLevel >= 4 && findSubset(g, s))
      || (maxLevel >= 5 && findContradiction(g, s))
      || null;
  }

  // Solve from scratch. Returns { solved, level, steps, counts }
  function rate(n, regions) {
    const g = makeGeometry(n, regions);
    const s = newState(g);
    const counts = { single: 0, confine: 0, blocker: 0, subset: 0, contradiction: 0 };
    let level = 0, steps = 0;
    for (let guard = 0; guard < 2000; guard++) {
      if (isSolved(g, s)) return { solved: true, level, steps, counts };
      if (isBroken(g, s)) return { solved: false, level, steps, counts };
      const st = nextStep(g, s);
      if (!st) return { solved: false, level, steps, counts };
      counts[st.tech]++; steps++;
      level = Math.max(level, st.level);
      apply(g, s, st);
    }
    return { solved: false, level, steps, counts };
  }

  // Difficulty tiers: 0 easy, 1 medium, 2 hard, 3 expert
  function tierOf(r) {
    if (!r.solved) return -1;
    if (r.level <= 1) return 0;
    if (r.level <= 3) return 1;
    if (r.level === 4 || (r.level === 5 && r.counts.contradiction <= 1)) return 2;
    return 3;
  }

  // Allowed board sizes per tier (some combinations are too rare to generate quickly)
  const TIER_SIZES = [[5, 6, 7, 8], [5, 6, 7, 8, 9, 10], [6, 7, 8, 9, 10], [7, 8, 9, 10]];

  function mixSeed(seed, k) {
    let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    return (h ^ (h >>> 13)) >>> 0;
  }

  // Deterministic: same (n, tier, seed) always yields the same puzzle.
  function generateRated(engine, n, tier, seed, maxTries = 600) {
    let fallback = null, fallbackDist = 9;
    for (let k = 0; k < maxTries; k++) {
      const p = engine.generate(n, mixSeed(seed, k));
      if (!p) continue;
      const r = rate(n, p.regions);
      const t = tierOf(r);
      if (t === tier) { p.tier = t; p.rating = r; p.baseSeed = seed; return p; }
      if (t >= 0 && Math.abs(t - tier) < fallbackDist) { fallback = Object.assign(p, { tier: t, rating: r, baseSeed: seed }); fallbackDist = Math.abs(t - tier); }
    }
    return fallback;
  }

  const api = { TIER_SIZES, mixSeed, generateRated, LEVEL, makeGeometry, newState, clone, nextStep, apply, placeCat, rate, tierOf, isSolved, isBroken };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CatnapLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
