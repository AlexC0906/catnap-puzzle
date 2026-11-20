const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');
const L = require('../src/logic.js');
const LEVELS = require('../src/levels.js');

function logicSolve(n, regions) {
  const g = L.makeGeometry(n, regions);
  const s = L.newState(g);
  for (let k = 0; k < 500 && !L.isSolved(g, s); k++) {
    const st = L.nextStep(g, s);
    if (!st) break;
    L.apply(g, s, st);
  }
  if (!L.isSolved(g, s)) return null;
  const cols = new Array(n);
  s.cat.forEach((v, i) => { if (v) cols[Math.floor(i / n)] = i % n; });
  return cols;
}

test('every logic step is sound (never eliminates or places against the solution)', () => {
  for (const n of [6, 8, 10]) {
    for (let seed = 1; seed <= 8; seed++) {
      const p = E.generate(n, seed * 31337);
      const g = L.makeGeometry(n, p.regions);
      const s = L.newState(g);
      for (let k = 0; k < 500 && !L.isSolved(g, s); k++) {
        const st = L.nextStep(g, s);
        assert.ok(st, 'solver should not get stuck');
        if (st.place != null) assert.strictEqual(p.solution[Math.floor(st.place / n)], st.place % n, `${st.tech} placed a wrong cat`);
        for (const i of st.eliminate || []) assert.notStrictEqual(p.solution[Math.floor(i / n)], i % n, `${st.tech} eliminated a solution cell`);
        L.apply(g, s, st);
      }
    }
  }
});

test('rated generation hits the requested tier and is deterministic', () => {
  L.TIER_SIZES.forEach((sizes, tier) => {
    for (const n of sizes.slice(0, 3)) {
      const a = L.generateRated(E, n, tier, 4242);
      const b = L.generateRated(E, n, tier, 4242);
      assert.strictEqual(a.tier, tier, `n=${n} tier=${tier}`);
      assert.deepStrictEqual(a.regions, b.regions);
      assert.deepStrictEqual(logicSolve(n, a.regions), a.solution, 'solvable by logic alone');
    }
  });
});

test('journey: 60 levels, each unique, logic-solvable and at its stated tier', () => {
  assert.strictEqual(LEVELS.length, 60);
  LEVELS.forEach((lv, i) => {
    const regions = [...lv.r].map(Number);
    assert.strictEqual(regions.length, lv.n * lv.n, `level ${i + 1} size`);
    assert.strictEqual(new Set(regions).size, lv.n, `level ${i + 1} cushion count`);
    const sols = E.solve(lv.n, regions, 2);
    assert.strictEqual(sols.length, 1, `level ${i + 1} unique`);
    assert.deepStrictEqual(logicSolve(lv.n, regions), sols[0], `level ${i + 1} logic`);
    assert.strictEqual(L.tierOf(L.rate(lv.n, regions)), lv.tier, `level ${i + 1} tier`);
  });
});

test('journey difficulty never jumps by more than two tiers between levels', () => {
  for (let i = 1; i < LEVELS.length; i++) assert.ok(Math.abs(LEVELS[i].tier - LEVELS[i - 1].tier) <= 2);
  assert.strictEqual(LEVELS[0].n, 5);
  assert.strictEqual(LEVELS[0].tier, 0);
});
