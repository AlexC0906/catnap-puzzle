// Runs in the "phone" project (Pixel 7: small screen, touch).
const { test, expect, open, cell, solution } = require('./helpers');

test('nothing is wider than the screen, in every mode and in both themes', async ({ page }) => {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const mode of ['daily', 'journey', 'free', 'workshop']) {
      await open(page, { mode });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${mode} (${scheme}) overflows horizontally`).toBeLessThanOrEqual(0);
    }
  }
});

test('the board and the game buttons fit on one screen', async ({ page }) => {
  await open(page, { mode: 'free' });
  const vh = page.viewportSize().height;
  const frame = await page.locator('#frame').boundingBox();
  const controls = await page.locator('.controls').boundingBox();
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(controls.y + controls.height, 'Undo/Hint/Pause must be visible without scrolling').toBeLessThanOrEqual(vh);
});

test('touch: tap for ×, double-tap for a cat, and the whole puzzle by touch', async ({ page }) => {
  await open(page, { mode: 'journey', level: 1 });
  const tapAt = async i => { const b = await cell(page, i).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  await tapAt(0);
  await expect(cell(page, 0)).toHaveAttribute('data-v', 'x');
  await page.waitForTimeout(450);
  await tapAt(0);
  await expect(cell(page, 0)).toHaveAttribute('data-v', '');
  await page.waitForTimeout(450);
  const { n, sol } = await solution(page);
  for (let r = 0; r < n; r++) {
    await tapAt(r * n + sol[r]);
    await page.waitForTimeout(60);
    await tapAt(r * n + sol[r]);
    await page.waitForTimeout(450);
  }
  await expect(page.locator('#win')).toBeVisible();
});

test('the mascot can be petted with a finger', async ({ page }) => {
  await open(page, { mode: 'free' });
  const head = await page.locator('#mascot .mHead').boundingBox();
  const x = head.x + head.width / 2, y = head.y + head.height * 0.45;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 20, y }] });
  for (let k = 0; k < 12; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (k % 2 ? 20 : -20), y }] });
    await page.waitForTimeout(40);
  }
  await expect(page.locator('#mascot')).toHaveClass(/pet/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // the page must not have scrolled while petting
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the mascot’s speech bubble does not cover the mode bar on a phone', async ({ page }) => {
  for (const mode of ['daily', 'free', 'journey']) {
    await open(page, { mode });
    await page.evaluate(() => {
      const L = window.CatnapI18n.STRINGS;
      const all = Object.values(L).flatMap(x => x.sayFacts.map(f => `${x.sayFactIntro} ${f}`));
      const b = document.getElementById('bubble');
      b.style.fontFamily = '"DejaVu Sans", Verdana, sans-serif'; // worst case: wide fallback font
      b.textContent = all.sort((a, c) => c.length - a.length)[0];
      b.hidden = false;
    });
    await page.waitForTimeout(400);
    const bubble = await page.locator('#bubble').boundingBox(), bar = await page.locator('#modebar').boundingBox();
    expect(bubble.y, mode).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(bubble.x, 'bubble stays on screen').toBeGreaterThanOrEqual(0);
  }
});
