// Shared helpers for the end-to-end tests.
const base = require('@playwright/test');

// Every test fails if the page throws or logs an error.
const test = base.test.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    // keep tests offline and deterministic
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await use(page);
    // a test can declare errors it provokes on purpose: page.allowErrors = /pattern/
    const unexpected = errors.filter(e => !(page.allowErrors && page.allowErrors.test(e)));
    base.expect(unexpected, 'page errors').toEqual([]);
  }
});

/**
 * Open the game with a prepared localStorage.
 * opts: { mode, level, lang, settings, progress, hash, storage }
 */
async function open(page, opts = {}) {
  await page.goto('/index.html');
  await page.evaluate(o => {
    localStorage.clear();
    const set = (k, v) => localStorage.setItem('catnap:' + k, JSON.stringify(v));
    set('seenHelp', o.seenHelp ?? true);
    set('lang', o.lang || 'en');
    if (o.mode) set('mode', o.mode);
    if (o.level) set('level', o.level);
    if (o.settings) set('settings', o.settings);
    if (o.progress) set('progress', o.progress);
    for (const [k, v] of Object.entries(o.storage || {})) set(k, v);
  }, opts);
  // a query string forces a real reload even when only the hash changes
  await page.goto('/index.html?e2e=1' + (opts.hash ? '#' + opts.hash : ''));
  await page.waitForFunction(() => document.querySelectorAll('#board .cell').length > 0 && document.getElementById('loading').hidden);
}

const cells = page => page.locator('#board .cell');
const cell = (page, i) => cells(page).nth(i);

/** Board size and the unique solution, read from the rendered board. */
async function solution(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('#board .cell')];
    const n = Math.round(Math.sqrt(els.length));
    const regions = els.map(c => 'ABCDEFGHIJ'.indexOf(c.dataset.l));
    return { n, regions, sol: window.CatnapEngine.solve(n, regions, 1)[0] };
  });
}

/** Place every cat of the solution with double-clicks. */
async function solve(page, { skipRows = [] } = {}) {
  const { n, sol } = await solution(page);
  for (let r = 0; r < n; r++) {
    if (skipRows.includes(r)) continue;
    await cell(page, r * n + sol[r]).dblclick();
  }
  return { n, sol };
}

/** Starts the game clock with an × that is removed again. */
async function startClock(page, i = 0) {
  await cell(page, i).click();
  await page.waitForTimeout(450);
  await cell(page, i).click();
  await page.waitForTimeout(450);
}

const progressWithStars = upTo => {
  const stars = {};
  for (let k = 1; k <= upTo; k++) stars[k] = 3;
  return { stars, best: {}, solved: upTo, byTier: [upTo, 0, 0, 0], daily: { last: null, streak: 0, best: 0, done: {} }, skins: [], ach: {}, flags: {} };
};

/** Advance a fake clock in small steps until `done()` is true (lets real network replies arrive). */
async function runUntil(page, done, { step = 1000, max = 600 } = {}) {
  for (let k = 0; k < max; k++) {
    if (await done()) return;
    await page.clock.runFor(step);
  }
  throw new Error('runUntil: condition never became true');
}

module.exports = { runUntil, test, expect: base.expect, open, cells, cell, solution, solve, startClock, progressWithStars };
