import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const port = 8795;
const url = `http://127.0.0.1:${port}/`;
const server = spawn('pnpm', ['start', '--port', String(port)], {
  stdio: 'inherit',
  detached: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Local Worker exited');
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) return;
    await delay(500);
  }
  throw new Error('Local Worker did not become ready');
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || 'google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
  await page.goto(url);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const timeline = page.locator('.day-card .timeline').first();
    await timeline.locator('.answer-band').first().waitFor({ state: 'attached' });
    const bands = await timeline.evaluate(table => {
      const joined = table.querySelector('.answer-slot.available + .answer-slot.available');
      const first = joined?.previousElementSibling?.querySelector('.answer-band');
      const second = joined?.querySelector('.answer-band');
      const gap = table.querySelector('.answer-slot.available + .answer-slot:not(.available)');
      return {
        distance: first && second
          ? second.getBoundingClientRect().left - first.getBoundingClientRect().right
          : null,
        gapEndsBand: !!gap?.previousElementSibling?.querySelector('.band-end')
          && !!gap && !gap.querySelector('.answer-band'),
      };
    });
    assert.ok(bands.distance !== null && Math.abs(bands.distance) <= 1, 'Adjacent slots form one band');
    assert.ok(bands.gapEndsBand, 'Unavailable slots break the band');
    await timeline.locator("xpath=ancestor::article").screenshot({path: `preview/answer-bands-${width}.png`});
    console.log(`Answer bands passed at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.new-event').click();
  await page.locator('.calendar-grid button:enabled').first().click();

  const scroller = page.locator('.selection-scroller');
  const earlier = page.getByRole('button', { name: '早い時間へ', exact: true });
  const later = page.getByRole('button', { name: '遅い時間へ', exact: true });
  await earlier.locator('svg').waitFor();
  await later.locator('svg').waitFor();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await scroller.evaluate(element => { element.scrollLeft = 0; });
    await earlier.and(page.locator(':disabled')).waitFor();
    await later.and(page.locator(':enabled')).click();
    await earlier.and(page.locator(':enabled')).waitFor();
    await later.and(page.locator(':enabled')).waitFor();

    await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await later.and(page.locator(':disabled')).waitFor();
    await earlier.and(page.locator(':enabled')).click();
    await later.and(page.locator(':enabled')).waitFor();
    console.log(`Timeline arrows passed at ${width}px`);
  }
} finally {
  try {
    await browser?.close();
  } finally {
    if (server.pid && server.exitCode === null) process.kill(-server.pid, 'SIGTERM');
  }
}
