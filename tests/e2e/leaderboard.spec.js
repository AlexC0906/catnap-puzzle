// The leaderboard client against a fake Supabase (page.route), so tests
// never touch the live database.
const { test, expect, open, startClock, solve, runUntil, progressWithStars } = require('./helpers');

const API = 'https://lb.test';
const KEY = 'sb_publishable_test';

async function fakeSupabase(page, { fail = false } = {}) {
  const db = { rows: [], posts: [] };
  await page.route('**/src/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.CATNAP_CONFIG = { supabaseUrl: '${API}', supabaseKey: '${KEY}' };` }));
  await page.route(`${API}/rest/v1/**`, async route => {
    const req = route.request();
    const h = req.headers();
    if (h.apikey !== KEY || h.authorization) return route.fulfill({ status: 401, json: { message: 'publishable keys go only in apikey' } });
    if (fail) return route.fulfill({ status: 500, json: { message: 'down' } });
    const url = new URL(req.url());
    if (url.pathname.endsWith('/rpc/submit_score')) {
      const b = req.postDataJSON();
      db.posts.push(b);
      const pid = b.p_player.slice(0, 16);
      const old = db.rows.find(r => r.board === b.p_board && r.pid === pid);
      if (old) Object.assign(old, { time_ms: Math.min(old.time_ms ?? Infinity, b.p_time_ms ?? Infinity), score: Math.max(old.score ?? 0, b.p_score ?? 0), name: b.p_name });
      else db.rows.push({ board: b.p_board, pid, name: b.p_name, time_ms: b.p_time_ms, score: b.p_score });
      const same = db.rows.filter(r => r.board === b.p_board);
      return route.fulfill({ json: { rank: same.length, total: same.length, best: b.p_time_ms ?? b.p_score } });
    }
    if (url.pathname.endsWith('/leaderboard')) {
      const board = url.searchParams.get('board').replace('eq.', '');
      return route.fulfill({ json: db.rows.filter(r => r.board === board).map(({ name, time_ms, score, pid }) => ({ name, time_ms, score, pid })) });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return db;
}

test('a clean solve asks for a name once, submits a checkable solution and shows the rank', async ({ page }) => {
  const db = await fakeSupabase(page);
  await page.clock.install();
  await open(page, { mode: 'journey', level: 1 });
  await startClock(page);
  await page.clock.runFor(4000);
  const { sol } = await solve(page);
  await expect(page.locator('#winLBBtn')).toHaveText('Join the leaderboard');
  await page.click('#winLBBtn');
  await page.fill('#nameInput', 'Alex');
  await page.click('#nameForm button[type=submit]');
  await expect(page.locator('#winLBText')).toHaveText('🏆 Rank 1 of 1');
  expect(db.posts).toHaveLength(1);
  const p = db.posts[0];
  expect(p).toMatchObject({ p_board: 'level-1', p_name: 'Alex', p_solution: sol });
  expect(p.p_time_ms).toBeGreaterThanOrEqual(3000);
  expect(p.p_regions).toMatch(/^[0-9]{25}$/);

  await page.click('#winLBBtn');
  await expect(page.locator('#dlgLB')).toBeVisible();
  await expect(page.locator('#lbList li')).toHaveCount(1);
  await expect(page.locator('#lbList')).toContainText('Alex');
  await expect(page.locator('#lbMe')).toHaveText('Playing as Alex.');
});

test('solves with hints are not submitted', async ({ page }) => {
  const db = await fakeSupabase(page);
  await page.clock.install();
  // level 3: the first two levels coach for free, so hints there do not count
  await open(page, { mode: 'journey', level: 3, progress: progressWithStars(2), settings: { playerName: 'Alex' } });
  await page.click('#hint');
  await page.click('#hintClose');
  await page.clock.runFor(4000);
  await solve(page);
  await expect(page.locator('#winLBText')).toHaveText('Only solves without hints enter the leaderboard.');
  expect(db.posts).toHaveLength(0);
});

test('a failing server is reported without breaking the game', async ({ page }) => {
  await fakeSupabase(page, { fail: true });
  page.allowErrors = /status of 500/;
  await page.clock.install();
  await open(page, { mode: 'journey', level: 1, settings: { playerName: 'Alex' } });
  await startClock(page);
  await page.clock.runFor(4000);
  await solve(page);
  await expect(page.locator('#winLBText')).toHaveText('Could not send your score.');
  await page.click('#winLBBtn');
  await expect(page.locator('#lbList')).toContainText('not available right now');
});

test('the marathon score goes to this week’s board', async ({ page }) => {
  const db = await fakeSupabase(page);
  await page.clock.install();
  await open(page, { mode: 'free', settings: { playerName: 'Ion' } });
  await page.click('#marBtn');
  await page.click('#marGo');
  // the first marathon board is generated in the background: wait for it
  await expect(page.locator('#puzzleName')).toHaveText('Marathon · #1');
  await solve(page);
  // jump close to the end (5:00 of 5:15), then step so the network reply can arrive
  await page.clock.runFor(5 * 60 * 1000);
  await runUntil(page, () => page.locator('#marCard').filter({ hasText: 'Time’s up' }).isVisible(), { max: 60 });
  await expect(page.locator('#marCard')).toContainText('Rank 1 of 1');
  const week = await page.evaluate(() => window.CatnapLB.isoWeek());
  expect(db.posts.at(-1)).toMatchObject({ p_board: `marathon-${week}`, p_score: 25, p_name: 'Ion' });
});

test('the daily tab has a Leaderboard button when a backend is configured', async ({ page }) => {
  await fakeSupabase(page);
  await open(page, { mode: 'daily' });
  await page.click('#dLB');
  await expect(page.locator('#lbList')).toContainText('Nobody here yet');
});
