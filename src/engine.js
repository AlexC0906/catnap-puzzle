// Mustăți — puzzle engine: seeded RNG, solver, generator.
// Rules: N×N board split into N colored regions. Place N cats so that each
// row, each column and each region holds exactly one cat, and no two cats
// touch (not even diagonally).
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Random valid cat placement: cols[r] = column of cat in row r.
  function randomPlacement(n, rnd) {
    const cols = new Array(n).fill(-1);
    const used = new Array(n).fill(false);
    function place(r) {
      if (r === n) return true;
      const order = shuffle([...Array(n).keys()], rnd);
      for (const c of order) {
        if (used[c]) continue;
        if (r > 0 && Math.abs(cols[r - 1] - c) <= 1) continue;
        cols[r] = c; used[c] = true;
        if (place(r + 1)) return true;
        used[c] = false; cols[r] = -1;
      }
      return false;
    }
    return place(0) ? cols : null;
  }

  // Count solutions (stops at `limit`). regions: flat array n*n of region ids.
  // `fixed` optional: array of known cat columns per row (-1 = unknown).
  function solve(n, regions, limit = 2) {
    const cols = new Array(n).fill(-1);
    const usedCol = new Array(n).fill(false);
    const usedReg = new Array(n).fill(false);
    const solutions = [];
    function rec(r) {
      if (solutions.length >= limit) return;
      if (r === n) { solutions.push(cols.slice()); return; }
      for (let c = 0; c < n; c++) {
        if (usedCol[c]) continue;
        const g = regions[r * n + c];
        if (usedReg[g]) continue;
        if (r > 0 && Math.abs(cols[r - 1] - c) <= 1) continue;
        cols[r] = c; usedCol[c] = true; usedReg[g] = true;
        rec(r + 1);
        usedCol[c] = false; usedReg[g] = false; cols[r] = -1;
        if (solutions.length >= limit) return;
      }
    }
    rec(0);
    return solutions;
  }

  // Grow regions from the cat cells by random flood fill.
  function growRegions(n, cols, rnd) {
    const regions = new Array(n * n).fill(-1);
    const frontier = [];
    for (let r = 0; r < n; r++) {
      regions[r * n + cols[r]] = r;
      frontier.push(r * n + cols[r]);
    }
    let remaining = n * n - n;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // Bias: each step picks a random region-owned cell, tries to claim a neighbor.
    // Slightly favour smaller regions so sizes stay varied but not degenerate.
    const sizes = new Array(n).fill(1);
    let guard = 0;
    while (remaining > 0 && guard++ < 200000) {
      const idx = frontier[Math.floor(rnd() * frontier.length)];
      const g = regions[idx];
      if (rnd() < 0.35 && sizes[g] > (n * n) / n * 1.6) continue;
      const r = Math.floor(idx / n), c = idx % n;
      const d = dirs[Math.floor(rnd() * 4)];
      const nr = r + d[0], nc = c + d[1];
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
      const nidx = nr * n + nc;
      if (regions[nidx] !== -1) continue;
      regions[nidx] = g; sizes[g]++;
      frontier.push(nidx);
      remaining--;
    }
    return remaining === 0 ? regions : null;
  }

  // Try to repair a non-unique puzzle: move a cell from one region to a
  // neighbouring region so that an alternative solution becomes invalid,
  // while the intended solution stays valid.
  function regionsConnected(n, regions, g) {
    let start = -1, count = 0;
    for (let i = 0; i < n * n; i++) if (regions[i] === g) { count++; if (start < 0) start = i; }
    if (count === 0) return false;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      const r = Math.floor(i / n), c = i % n;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const j = nr * n + nc;
        if (regions[j] === g && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    return seen.size === count;
  }

  function repair(n, regions, cols, alt, rnd) {
    // cells used by the alternative solution but not the intended one
    const catCells = new Set(cols.map((c, r) => r * n + c));
    const altCells = shuffle(alt.map((c, r) => r * n + c).filter(i => !catCells.has(i)), rnd);
    for (const i of altCells) {
      const r = Math.floor(i / n), c = i % n;
      const from = regions[i];
      const neigh = [];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const g = regions[nr * n + nc];
        if (g !== from) neigh.push(g);
      }
      shuffle(neigh, rnd);
      for (const to of neigh) {
        regions[i] = to;
        if (regionsConnected(n, regions, from)) return true;
        regions[i] = from;
      }
    }
    return false;
  }

  function generate(n, seed) {
    const rnd = mulberry32(seed);
    for (let attempt = 0; attempt < 400; attempt++) {
      const cols = randomPlacement(n, rnd);
      if (!cols) continue;
      const regions = growRegions(n, cols, rnd);
      if (!regions) continue;
      for (let fix = 0; fix < 60; fix++) {
        const sols = solve(n, regions, 2);
        if (sols.length === 1) {
          return { n, regions, solution: sols[0], seed };
        }
        const alt = sols.find(s => s.some((c, r) => c !== cols[r]));
        if (!alt || !repair(n, regions, cols, alt, rnd)) break;
      }
    }
    return null;
  }

  // Basic difficulty estimate: how much a simple logic pass can deduce.
  const api = { mulberry32, hashString, generate, solve, randomPlacement, growRegions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MustatiEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
