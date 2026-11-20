const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

function connected(n, regions, g) {
  const cells = [];
  for (let i = 0; i < n * n; i++) if (regions[i] === g) cells.push(i);
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const i = stack.pop(), r = Math.floor(i / n), c = i % n;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
      const j = nr * n + nc;
      if (regions[j] === g && !seen.has(j)) { seen.add(j); stack.push(j); }
    }
  }
  return seen.size === cells.length;
}

for (const n of [5, 6, 7, 8, 9, 10]) {
  test(`${n}x${n}: puzzles are valid and have exactly one solution`, () => {
    for (let s = 1; s <= 25; s++) {
      const p = E.generate(n, s * 104729);
      assert.ok(p, 'generator returned a puzzle');
      assert.strictEqual(p.regions.length, n * n);
      for (let g = 0; g < n; g++) assert.ok(connected(n, p.regions, g), `region ${g} is connected`);
      const sols = E.solve(n, p.regions, 2);
      assert.strictEqual(sols.length, 1, 'unique solution');
      const sol = sols[0];
      assert.deepStrictEqual(sol, p.solution);
      assert.strictEqual(new Set(sol).size, n, 'one cat per column');
      assert.strictEqual(new Set(sol.map((c, r) => p.regions[r * n + c])).size, n, 'one cat per region');
      for (let r = 1; r < n; r++) assert.ok(Math.abs(sol[r] - sol[r - 1]) > 1, 'cats do not touch');
    }
  });
}

test('same seed gives the same puzzle (daily puzzle is shared)', () => {
  const a = E.generate(8, E.hashString('mustati-2026-11-21'));
  const b = E.generate(8, E.hashString('mustati-2026-11-21'));
  assert.deepStrictEqual(a.regions, b.regions);
});
