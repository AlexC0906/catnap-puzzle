// Catnap — chapters and achievements.
(function (root) {
  'use strict';

  // Journey chapters: 6 × 10 levels
  const CHAPTERS = [
    { id: 'yarn', from: 1, to: 10, color: 'r2' },
    { id: 'window', from: 11, to: 20, color: 'r1' },
    { id: 'garden', from: 21, to: 30, color: 'r6' },
    { id: 'library', from: 31, to: 40, color: 'r3' },
    { id: 'attic', from: 41, to: 50, color: 'r0' },
    { id: 'roofs', from: 51, to: 60, color: 'r4' }
  ];
  const chapterOf = level => CHAPTERS.findIndex(c => level >= c.from && level <= c.to);
  const chapterDone = (p, c) => { for (let k = c.from; k <= c.to; k++) if (!p.stars[k]) return false; return true; };
  const chapterStars = (p, c) => { let s = 0; for (let k = c.from; k <= c.to; k++) s += p.stars[k] || 0; return s; };
  const totalStars = p => Object.values(p.stars || {}).reduce((a, b) => a + b, 0);

  // Each achievement: test(progress, event?) → boolean.
  // event (only on a solve): { kind, tier, n, hints, elapsed, date, isToday, hour }
  const clean = e => e && e.hints === 0;
  const ACHIEVEMENTS = [
    { id: 'first', test: p => p.solved >= 1 },
    { id: 'nine', test: p => p.solved >= 9 },
    { id: 'shelter', test: p => p.solved >= 50 },
    { id: 'royal', test: p => p.solved >= 100 },
    { id: 'flavors', test: p => (p.byTier || []).filter(x => x > 0).length === 4 },
    { id: 'clean', test: (p, e) => clean(e) && e.tier >= 2 },
    { id: 'expert', test: (p, e) => !!e && e.tier === 3 },
    { id: 'feline', test: (p, e) => clean(e) && e.tier === 3 },
    { id: 'quick', test: (p, e) => clean(e) && e.n >= 6 && e.elapsed < 45000 },
    { id: 'lightning', test: (p, e) => clean(e) && e.n >= 8 && e.elapsed < 120000 },
    { id: 'cheetah', test: (p, e) => clean(e) && e.n >= 10 && e.elapsed < 300000 },
    { id: 'habit', test: p => p.daily.best >= 3 },
    { id: 'week', test: p => p.daily.best >= 7 },
    { id: 'month', test: p => p.daily.best >= 30 },
    { id: 'traveler', test: (p, e) => !!e && e.kind === 'daily' && !e.isToday },
    { id: 'chapter', test: p => chapterDone(p, CHAPTERS[0]) },
    { id: 'wanderer', test: p => CHAPTERS.every(c => chapterDone(p, c)) },
    { id: 'constellation', test: p => totalStars(p) >= 180 },
    { id: 'owl', test: (p, e) => !!e && e.hour >= 0 && e.hour < 5 },
    { id: 'architect', test: p => !!(p.flags && p.flags.created) },
    { id: 'marathon', test: p => (p.marathon && p.marathon.bestSolved || 0) >= 5 },
    { id: 'ultra', test: p => (p.marathon && p.marathon.bestSolved || 0) >= 12 }
  ];

  // Returns the ids that are newly earned and records them in p.ach.
  function check(p, event) {
    p.ach = p.ach || {};
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (p.ach[a.id]) continue;
      let ok = false;
      try { ok = a.test(p, event); } catch { ok = false; }
      if (ok) { p.ach[a.id] = Date.now(); fresh.push(a.id); }
    }
    return fresh;
  }

  const api = { CHAPTERS, ACHIEVEMENTS, chapterOf, chapterDone, chapterStars, totalStars, check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CatnapAch = api;
})(typeof window !== 'undefined' ? window : globalThis);
