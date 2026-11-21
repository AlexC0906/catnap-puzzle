const { test, expect, open, cell, solution, solve, progressWithStars } = require('./helpers');

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test.describe('daily', () => {
  test('loads today’s puzzle, the same one for every player', async ({ page, browser }) => {
    await open(page, { mode: 'daily' });
    await expect(page.locator('#puzzleName')).toHaveText(`Daily puzzle · ${today()}`);
    const a = (await solution(page)).regions.join('');
    const other = await browser.newPage();
    await open(other, { mode: 'daily' });
    expect((await solution(other)).regions.join('')).toBe(a);
    await other.close();
  });

  test('the archive calendar opens past days and Today comes back', async ({ page }) => {
    await open(page, { mode: 'daily' });
    await page.click('#dArchive');
    await expect(page.locator('#dlgArchive')).toBeVisible();
    const past = page.locator('#archGrid .day:not([disabled]):not(.today)').first();
    const key = await past.getAttribute('data-k');
    test.skip(!key, 'first day of the month: no past day in this view');
    await past.click();
    await expect(page.locator('#puzzleName')).toHaveText(`Daily puzzle · ${key}`);
    await page.click('#dToday');
    await expect(page.locator('#puzzleName')).toHaveText(`Daily puzzle · ${today()}`);
  });

  test('solving today’s puzzle starts a streak', async ({ page }) => {
    await open(page, { mode: 'daily' });
    await solve(page);
    await expect(page.locator('#win')).toBeVisible();
    await expect(page.locator('#winExtra')).toContainText('Streak: 1');
    await expect(page.locator('#winCountdown')).toContainText('Next daily puzzle in');
  });
});

test.describe('journey', () => {
  test('levels are grouped in 6 chapters and locked until reached', async ({ page }) => {
    await open(page, { mode: 'journey', level: 4, progress: progressWithStars(3) });
    await page.click('#lvOpen');
    await expect(page.locator('#levelGrid .chHead')).toHaveCount(6);
    await expect(page.locator('#levelGrid .lvl:not([disabled])')).toHaveCount(4);
    await expect(page.locator('#levelGrid .lvl.cur')).toHaveText(/4/);
    await page.locator('#levelGrid .lvl[data-k="2"]').click();
    await expect(page.locator('#puzzleName')).toHaveText('Level 2 of 60');
  });

  test('a locked level cannot be opened from a link', async ({ page }) => {
    await open(page, { mode: 'journey', hash: 'level-40' });
    await expect(page.locator('#puzzleName')).not.toHaveText('Level 40 of 60');
  });
});

test.describe('free play', () => {
  test('difficulty and size pick the board, and only valid sizes are offered', async ({ page }) => {
    await open(page, { mode: 'free' });
    await page.click('[data-tier="3"]');
    await expect(page.locator('[data-n="5"]')).toBeDisabled();
    await page.click('[data-n="7"]');
    await expect(page.locator('#tierBadge')).toHaveText('Expert · 7×7');
  });

  test('a shared link opens exactly the same puzzle', async ({ page, browser }) => {
    await open(page, { mode: 'free', hash: 'f-7-2-12345' });
    await expect(page.locator('#tierBadge')).toHaveText('Hard · 7×7');
    const a = (await solution(page)).regions.join('');
    const other = await browser.newPage();
    await open(other, { hash: 'f-7-2-12345' });
    expect((await solution(other)).regions.join('')).toBe(a);
    await other.close();
  });
});

test.describe('workshop', () => {
  test('a random design is valid, playable and shareable as a link', async ({ page, browser }) => {
    await open(page, { mode: 'workshop' });
    await expect(page.locator('#editPanel')).toBeVisible();
    await page.click('#wsRand');
    await expect(page.locator('#wsChecks li.bad')).toHaveCount(0);
    await expect(page.locator('#wsPlay')).toBeEnabled();
    const ed = await page.evaluate(() => JSON.parse(localStorage.getItem('catnap:workshop')));
    await page.click('#wsPlay');
    await expect(page.locator('#puzzleName')).toHaveText('Workshop puzzle');
    await solve(page);
    await expect(page.locator('#winNext')).toHaveText('Edit');

    const friend = await browser.newPage();
    await open(friend, { hash: `c-${ed.n}-${ed.regions.join('')}` });
    expect((await solution(friend)).regions.join('')).toBe(ed.regions.join(''));
    await friend.close();
  });

  test('painting shows what is missing, and a design with several solutions is refused', async ({ page }) => {
    await open(page, { mode: 'workshop' });
    await page.click('[data-n="6"]');
    await expect(page.locator('#wsChecks')).toContainText('36 cells left to paint');
    // 2×3 blocks: six cushions but many solutions
    await page.evaluate(() => {
      const r = []; for (let i = 0; i < 36; i++) r.push(((i / 6) | 0) >> 1 << 1 | (i % 6 >= 3 ? 1 : 0));
      localStorage.setItem('catnap:workshop', JSON.stringify({ n: 6, regions: r }));
    });
    await page.reload();
    await expect(page.locator('#wsChecks')).toContainText('several solutions');
    await expect(page.locator('#wsPlay')).toBeDisabled();
    await expect(page.locator('#board .cell.ht').first()).toBeVisible();
  });

  test('painting by hand with the brush', async ({ page }) => {
    await open(page, { mode: 'workshop' });
    await page.click('[data-n="5"]');
    await page.click('.swatch[data-g="2"]');
    await cell(page, 0).click();
    await expect(cell(page, 0)).not.toHaveClass(/blank/);
    await expect(page.locator('#wsChecks')).toContainText('24 cells left');
  });
});

test.describe('marathon', () => {
  test('a full 5-minute marathon: score, time bonus, results and best score', async ({ page }) => {
    await page.clock.install();
    await open(page, { mode: 'free' });
    await page.click('#marBtn');
    await expect(page.locator('#marCard')).toContainText('5-minute Marathon');
    await page.click('#marGo');
    await expect(page.locator('#puzzleName')).toHaveText('Marathon · #1');
    await expect(page.locator('#timerLabel')).toHaveText('Left');
    await solve(page);
    await page.clock.runFor(1500);
    await expect(page.locator('#puzzleName')).toHaveText('Marathon · #2');
    await expect(page.locator('#marScore')).toHaveText('25');
    await page.click('#marSkipBtn');
    await page.clock.runFor(1000);
    await expect(page.locator('#puzzleName')).toHaveText('Marathon · #3');
    await page.clock.runFor(6 * 60 * 1000);
    await expect(page.locator('#marCard')).toContainText('Time’s up!');
    await expect(page.locator('#marCard')).toContainText('1 puzzle · 25 points');
    const best = await page.evaluate(() => JSON.parse(localStorage.getItem('catnap:progress')).marathon.best);
    expect(best).toBe(25);
    await page.click('#tabJourney');
    await expect(page.locator('#marOv')).toBeHidden();
    await expect(page.locator('#timerLabel')).toHaveText('Time');
  });
});
