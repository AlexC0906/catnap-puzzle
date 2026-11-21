const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/achievements.js');
const LEVELS = require('../src/levels.js');

const fresh = () => ({ stars: {}, best: {}, solved: 0, byTier: [0, 0, 0, 0], daily: { last: null, streak: 0, best: 0, done: {} }, ach: {}, flags: {} });

test('chapters cover all 60 levels exactly once', () => {
  const seen = new Set();
  for (const c of A.CHAPTERS) for (let k = c.from; k <= c.to; k++) { assert.ok(!seen.has(k)); seen.add(k); }
  assert.strictEqual(seen.size, LEVELS.length);
  assert.strictEqual(A.chapterOf(1), 0);
  assert.strictEqual(A.chapterOf(60), 5);
});

test('first solve unlocks "first" once, never twice', () => {
  const p = fresh();
  p.solved = 1;
  assert.deepStrictEqual(A.check(p, { kind: 'free', tier: 0, n: 5, hints: 1, elapsed: 90000, hour: 14 }), ['first']);
  assert.deepStrictEqual(A.check(p, { kind: 'free', tier: 0, n: 5, hints: 1, elapsed: 90000, hour: 14 }), []);
});

test('event-based achievements need the right conditions', () => {
  const p = fresh();
  p.solved = 1;
  const got = A.check(p, { kind: 'daily', tier: 3, n: 10, hints: 0, elapsed: 100000, isToday: false, hour: 2 });
  for (const id of ['first', 'expert', 'feline', 'clean', 'lightning', 'cheetah', 'traveler', 'owl']) assert.ok(got.includes(id), id);
  assert.ok(!got.includes('quick'), 'quick needs < 45 s');
  const q = fresh(); q.solved = 1;
  const got2 = A.check(q, { kind: 'free', tier: 3, n: 10, hints: 2, elapsed: 20000, hour: 12 });
  assert.ok(got2.includes('expert') && !got2.includes('feline') && !got2.includes('quick'), 'hints block clean achievements');
});

test('progress-based achievements: streaks, chapters, stars', () => {
  const p = fresh();
  p.daily.best = 7;
  for (let k = 1; k <= 10; k++) p.stars[k] = 3;
  const got = A.check(p, null);
  assert.ok(got.includes('habit') && got.includes('week') && got.includes('chapter'));
  assert.ok(!got.includes('month') && !got.includes('wanderer'));
  for (let k = 1; k <= 60; k++) p.stars[k] = 3;
  const got2 = A.check(p, null);
  assert.ok(got2.includes('wanderer') && got2.includes('constellation'));
});

test('every line the mascot says is short enough for its speech bubble', () => {
  global.window = globalThis;
  require('../src/i18n.js');
  for (const [lang, L] of Object.entries(globalThis.CatnapI18n.STRINGS)) {
    const lines = [
      ...L.sayFacts.map(f => `${L.sayFactIntro} ${f}`),
      ...L.sayPet, ...L.sayConflict, ...L.sayWin, ...L.sayStuck,
      ...L.sayHello.map(h => `${h} ${L.petHint}`)
    ];
    for (const line of lines) assert.ok(line.length <= 62, `${lang}: "${line}" is ${line.length} chars (max 62)`);
  }
});
