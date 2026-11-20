const test = require('node:test');
const assert = require('node:assert');
const LB = require('../src/leaderboard.js');
const fs = require('fs');
const path = require('path');

test('ISO week ids match Postgres IYYY-"W"IW on known edge dates', () => {
  const cases = {
    '2024-01-01': '2024-W01', '2024-12-30': '2025-W01', '2026-01-01': '2026-W01',
    '2027-01-01': '2026-W53', '2026-11-21': '2026-W47', '2021-01-03': '2020-W53'
  };
  for (const [d, w] of Object.entries(cases)) {
    const [y, m, dd] = d.split('-').map(Number);
    assert.strictEqual(LB.isoWeek(new Date(y, m - 1, dd)), w, d);
  }
});

test('leaderboard is off without config', () => {
  assert.strictEqual(LB.enabled, false);
});

test('schema seeds exactly the shipped Journey boards', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  const LEVELS = require('../src/levels.js');
  LEVELS.forEach((lv, i) => assert.ok(sql.includes(`('level-${i + 1}', '${lv.r}')`), `level ${i + 1} seeded`));
});
