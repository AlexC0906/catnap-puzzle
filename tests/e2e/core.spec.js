const { test, expect, open, cell, cells, solution, solve, startClock } = require('./helpers');

test.describe('controls', () => {
  test('tap toggles ×, double-tap places a cat, tap removes it', async ({ page }) => {
    await open(page, { mode: 'free' });
    const c = cell(page, 0);
    await c.click();
    await expect(c).toHaveAttribute('data-v', 'x');
    await page.waitForTimeout(450);
    await c.click();
    await expect(c).toHaveAttribute('data-v', '');
    await page.waitForTimeout(450);
    await c.dblclick();
    await expect(c).toHaveAttribute('data-v', 'cat');
    await page.waitForTimeout(450);
    await c.click();
    await expect(c).toHaveAttribute('data-v', '');
  });

  test('double-tap on an × turns it into a cat, and undo restores the ×', async ({ page }) => {
    await open(page, { mode: 'free' });
    const c = cell(page, 3);
    await c.click();
    await page.waitForTimeout(450);
    await c.dblclick();
    await expect(c).toHaveAttribute('data-v', 'cat');
    await page.click('#undo');
    await expect(c).toHaveAttribute('data-v', 'x');
  });

  test('undo and redo from the keyboard', async ({ page }) => {
    await open(page, { mode: 'free' });
    await cell(page, 0).click();
    await page.waitForTimeout(450);
    await cell(page, 1).click();
    await page.keyboard.press('z');
    await expect(cell(page, 1)).toHaveAttribute('data-v', '');
    await expect(cell(page, 0)).toHaveAttribute('data-v', 'x');
    await page.keyboard.press('Shift+Z');
    await expect(cell(page, 1)).toHaveAttribute('data-v', 'x');
  });

  test('dragging marks several cells with ×', async ({ page }) => {
    await open(page, { mode: 'free' });
    const a = await cell(page, 0).boundingBox(), b = await cell(page, 3).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    for (const i of [0, 1, 2, 3]) await expect(cell(page, i)).toHaveAttribute('data-v', 'x');
  });

  test('two cats in one row are flagged as a mistake', async ({ page }) => {
    await open(page, { mode: 'free' });
    await cell(page, 0).dblclick();
    await cell(page, 2).dblclick();
    await expect(cell(page, 0)).toHaveClass(/bad/);
    await expect(cell(page, 2)).toHaveClass(/bad/);
    await expect(page.locator('#mascot')).toHaveClass(/scared/);
  });

  test('pause hides the board and resume brings it back', async ({ page }) => {
    await open(page, { mode: 'free' });
    await startClock(page);
    await page.click('#pause');
    await expect(page.locator('#pauseOv')).toBeVisible();
    await expect(page.locator('#mascot')).toHaveClass(/sleep/);
    await page.click('#resumeBtn');
    await expect(page.locator('#pauseOv')).toBeHidden();
  });
});

test.describe('solving', () => {
  test('solving a Journey level shows the win card with 3 stars and unlocks the next level', async ({ page }) => {
    await open(page, { mode: 'journey', level: 1 });
    await startClock(page);
    await solve(page);
    await expect(page.locator('#win')).toBeVisible();
    await expect(page.locator('#winStars svg.on')).toHaveCount(3);
    await expect(page.locator('#undo')).toBeDisabled();
    await page.click('#winNext');
    await expect(page.locator('#puzzleName')).toHaveText('Level 2 of 60');
  });

  test('hints alone can solve a puzzle, step by step', async ({ page }) => {
    await open(page, { mode: 'free', storage: { free: { n: 6, tier: 1, seed: 777 } } });
    for (let k = 0; k < 80; k++) {
      if (await page.locator('#board.won').count()) break;
      if (!(await page.locator('#hintBox').isVisible())) await page.click('#hint');
      await expect(page.locator('#hintText')).not.toBeEmpty();
      if (await page.locator('#hintApply').isVisible()) await page.click('#hintApply');
    }
    await expect(page.locator('#board')).toHaveClass(/won/);
    await expect(page.locator('#win')).toBeVisible();
    await expect(page.locator('#winText')).toContainText('hints');
  });

  test('a hint explains a wrong cat before anything else', async ({ page }) => {
    await open(page, { mode: 'free' });
    const { n, sol } = await solution(page);
    const wrong = sol[0] === 0 ? 1 : 0;
    await cell(page, wrong).dblclick();
    await page.click('#hint');
    await expect(page.locator('#hintText')).toContainText('wrong spot');
    await page.click('#hintApply');
    await expect(cell(page, wrong)).toHaveAttribute('data-v', '');
    expect(n).toBeGreaterThan(4);
  });

  test('progress is saved and restored after a reload', async ({ page }) => {
    await open(page, { mode: 'journey', level: 1 });
    await cell(page, 6).click();
    await page.reload();
    await expect(cell(page, 6)).toHaveAttribute('data-v', 'x');
  });
});

test.describe('language', () => {
  test('switching language translates the page and is remembered', async ({ page }) => {
    await open(page, { mode: 'free', lang: 'en' });
    await expect(page.locator('h1')).toHaveText('Catnap');
    await page.click('#lang');
    await expect(page.locator('h1')).toHaveText('Mustăți');
    await expect(page.locator('#tabFree')).toHaveText('Joc liber');
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Mustăți');
    await expect(page).toHaveTitle(/Mustăți/);
  });
});

test('every board cell is reachable from the keyboard', async ({ page }) => {
  await open(page, { mode: 'free' });
  await cell(page, 0).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('x');
  await expect(cell(page, 1)).toHaveAttribute('data-v', 'x');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('c');
  const { n } = await solution(page);
  await expect(cell(page, n + 1)).toHaveAttribute('data-v', 'cat');
  expect(await cells(page).count()).toBe(n * n);
});
