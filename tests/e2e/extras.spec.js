const { test, expect, open, cell, solve, startClock, progressWithStars } = require('./helpers');

test('first visit shows How to play, and its walkthrough solves a board step by step', async ({ page }) => {
  await page.clock.install();
  await open(page, { mode: 'free', seenHelp: false });
  await page.clock.runFor(800);
  await expect(page.locator('#dlgHelp')).toBeVisible();
  await expect(page.locator('#helpExampleLabel')).toHaveText('A solved board looks like this:');
  await page.click('#demoBtn');
  await page.clock.runFor(2000);
  await expect(page.locator('#helpExampleLabel')).toHaveText('Follow the reasoning, move by move:');
  await expect(page.locator('#demoText')).toContainText('cushion has only one free spot');
  for (let k = 0; k < 12; k++) await page.clock.runFor(4000);
  await expect(page.locator('#demoText')).toContainText('Done!');
  await expect(page.locator('#helpBoard .c')).toHaveCount(5);
});

test('the mascot’s speech bubble never covers the mode bar', async ({ page }) => {
  await open(page, { mode: 'free' });
  // the longest line the mascot can say, in either language
  const longest = await page.evaluate(() => {
    const all = [];
    for (const L of Object.values(window.CatnapI18n.STRINGS)) {
      L.sayFacts.forEach(f => all.push(`${L.sayFactIntro} ${f}`));
      ['sayPet', 'sayConflict', 'sayWin', 'sayStuck'].forEach(k => all.push(...L[k]));
      L.sayHello.forEach(h => all.push(`${h} ${L.petHint}`));
    }
    return all.sort((a, b) => b.length - a.length)[0];
  });
  await page.evaluate(text => { const b = document.getElementById('bubble'); b.textContent = text; b.hidden = false; }, longest);
  await page.waitForTimeout(400); // let the entrance animation finish
  const bubble = await page.locator('#bubble').boundingBox(), bar = await page.locator('#modebar').boundingBox();
  expect(bubble.y, longest).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(bubble.x, 'bubble stays on screen').toBeGreaterThanOrEqual(0);
});

test('the mascot purrs when stroked and talks when tapped', async ({ page }) => {
  await open(page, { mode: 'free' });
  const head = await page.locator('#mascot .mHead').boundingBox();
  const cx = head.x + head.width / 2, cy = head.y + head.height * 0.45;
  await page.mouse.move(cx - 30, cy);
  for (let k = 0; k < 10; k++) await page.mouse.move(cx + (k % 2 ? 25 : -25), cy, { steps: 4 });
  await expect(page.locator('#mascot')).toHaveClass(/pet/);
  await expect(page.locator('#petLayer svg').first()).toBeAttached();
  await page.mouse.move(cx + 400, cy + 400);
  await expect(page.locator('#mascot')).not.toHaveClass(/pet/);
  const pets = await page.evaluate(() => JSON.parse(localStorage.getItem('catnap:progress') || '{}').pets);
  expect(pets).toBe(1);
  await page.waitForTimeout(2600);
  await page.mouse.click(cx, cy);
  await expect(page.locator('#bubble')).toBeVisible();
  await expect(page.locator('#bubble')).not.toBeEmpty();
});

test('the share image is a 1080×1350 PNG', async ({ page }) => {
  await open(page, { mode: 'journey', level: 1 });
  await startClock(page);
  await solve(page);
  await expect(page.locator('#win')).toBeVisible();
  await page.click('#imgBtn');
  await expect(page.locator('#dlgImage')).toBeVisible();
  const img = await page.evaluate(async () => {
    const blob = await fetch(document.getElementById('shareImg').src).then(r => r.blob());
    const bmp = await createImageBitmap(blob);
    return { type: blob.type, size: blob.size, w: bmp.width, h: bmp.height };
  });
  expect(img).toMatchObject({ type: 'image/png', w: 1080, h: 1350 });
  expect(img.size).toBeGreaterThan(30000);
});

test('achievements unlock with a notification and are listed in Statistics', async ({ page }) => {
  await open(page, { mode: 'journey', level: 1 });
  await startClock(page);
  await solve(page);
  await expect(page.locator('.toast').filter({ hasText: 'First nap' })).toBeVisible({ timeout: 6000 });
  await page.locator('#win').click({ position: { x: 5, y: 5 }, force: true });
  await page.click('#btnStats');
  await expect(page.locator('#statsBody .ach.got')).not.toHaveCount(0);
  await expect(page.locator('#statsBody')).toContainText('First nap');
});

test('cat skins unlock with stars and change every cat', async ({ page }) => {
  await open(page, { mode: 'free' });
  await page.click('#btnSettings');
  await expect(page.locator('.skin[data-skin="tabby"]')).toBeDisabled();
  await open(page, { mode: 'free', progress: progressWithStars(10) });
  await page.click('#btnSettings');
  await expect(page.locator('.skin[data-skin="tabby"]')).toBeEnabled();
  await page.click('.skin[data-skin="tabby"]');
  await expect(page.locator('body')).toHaveClass(/skin-tabby/);
});

test('settings: auto-× and colour-blind labels', async ({ page }) => {
  await open(page, { mode: 'free' });
  await page.click('#btnSettings');
  await page.check('#optAutoX');
  await page.check('#optCb');
  await page.keyboard.press('Escape');
  await cell(page, 0).dblclick();
  await expect(page.locator('#board .cell[data-v="auto"]').first()).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/\bcb\b/);
});

test('the leaderboard stays hidden when no backend is configured', async ({ page }) => {
  await open(page, { mode: 'daily' });
  await expect(page.locator('#dLB')).toHaveCount(0);
  await expect(page.locator('#statsLB')).toBeHidden();
});
