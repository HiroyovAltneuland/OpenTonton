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
    const columnColors = await timeline.evaluate(table => {
      const cells = Array.from(table.querySelectorAll('.count-row td'));
      const row = table.querySelector('tr:has(.answer-slot)');
      return ['overlap-some', 'overlap-majority', 'all'].map(shade => {
        const index = cells.findIndex(cell => cell.classList.contains(shade));
        const answer = row?.cells[index + 1];
        return index >= 0 && answer
          ? [getComputedStyle(cells[index]).backgroundColor, getComputedStyle(answer).backgroundColor]
          : [];
      });
    });
    assert.deepEqual(columnColors, [
      ['rgb(240, 247, 243)', 'rgb(240, 247, 243)'],
      ['rgb(220, 238, 228)', 'rgb(220, 238, 228)'],
      ['rgb(185, 222, 202)', 'rgb(185, 222, 202)'],
    ]);
    console.log(`Answer bands and overlap shading passed at ${width}px`);
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
  // Exercise the real answer editor with small, deterministic event snapshots.
  const day = '2030-01-01';
  const nextDay = '2030-01-02';
  for (const [label, dates, expectedRange, expectedEnabled] of [
    ['one hour', [{ date: day, slots: [32, 33] }], '16:00–17:00', [32, 33]],
    ['last half hour', [{ date: day, slots: [47] }], '23:30–24:00', [47]],
    ['gap and shared axis', [{ date: day, slots: [18, 19, 36, 37] }, { date: nextDay, slots: [28] }], '09:00–19:00', [18, 19, 36, 37, 28]],
    ['midnight', [{ date: day, slots: [46, 47] }, { date: nextDay, slots: [0, 1] }], null, [46, 47, 0, 1]],
  ]) {
    const id = 'browser-test';
    const participant = { id: 'guest', nickname: 'Guest', role: 'participant', availability: {}, version: 1 };
    const event = { id, title: label, description: '', dates, duration: 60, timeZone: 'Asia/Tokyo',
      status: 'open', createdAt: Date.now(), expiresAt: Date.parse('2030-01-03'), confirmed: null, revision: 1 };
    const saved = Object.fromEntries(dates.map(date => [date.date, date.slots]));
    await page.route('**/api/events/browser-test', route => route.fulfill({ json: {
      event, members: [participant], me: participant,
    } }));
    await page.route('**/api/events/browser-test/answer', async route => {
      assert.equal(route.request().method(), 'PATCH');
      assert.deepEqual(route.request().postDataJSON().availability, saved);
      participant.availability = saved;
      await route.fulfill({ json: {} });
    });
    await page.goto(url + '?event=' + id);
    const edit = page.getByRole('button', { name: '回答を編集', exact: true });
    await page.getByRole('combobox', { name: '時刻の表示', exact: true }).selectOption('event');
    await edit.click();
    const slots = page.locator('.participant-selection [data-selection-slot]:enabled');
    assert.deepEqual(await slots.evaluateAll(nodes => nodes.map(node => Number(node.dataset.selectionSlot))), expectedEnabled);
    const toggle = page.getByRole('button', { name: '24時間表示', exact: true });
    if (expectedRange) {
      assert.equal(await page.locator('.selection-window').first().innerText(), expectedRange);
    } else {
      assert.equal(await toggle.count(), 0, 'A full-width candidate range already shows 24 hours');
    }
    if (label === 'one hour' || label === 'last half hour') {
      const fits = await page.locator('.participant-selection .selection-scroller')
        .evaluate(node => node.scrollWidth <= node.clientWidth + 1);
      assert.ok(fits, 'Short ranges fit at 390px');
    }
    if (label === 'gap and shared axis') {
      assert.equal(await page.locator(`[data-date="${day}"][data-selection-slot="28"]:disabled`).count(), 1);
      assert.equal(await page.locator(`[data-date="${nextDay}"][data-selection-slot="18"]:disabled`).count(), 1);
    }
    for (const slot of await slots.all()) await slot.click();
    if (expectedRange) {
      await toggle.click();
      assert.equal(await page.locator('.participant-selection [data-selection-slot]').count(), dates.length * 48);
      await page.getByRole('button', { name: '候補範囲を表示', exact: true }).click();
    }
    await page.getByRole('combobox', { name: '時刻の表示', exact: true }).selectOption('custom');
    await page.getByRole('combobox', { name: '表示のタイムゾーン', exact: true }).selectOption('UTC');
    assert.equal(await slots.and(page.locator('[aria-pressed="true"]')).count(), expectedEnabled.length);
    await page.getByRole('button', { name: '回答を保存', exact: true }).click();
    await page.getByText('回答を保存しました', { exact: true }).waitFor();
    assert.deepEqual(participant.availability, saved);
    await page.reload();
    await edit.click();
    assert.equal(await slots.and(page.locator('[aria-pressed="true"]')).count(), expectedEnabled.length);
    await page.unrouteAll({ behavior: 'wait' });
    console.log(`Answer editor edge case passed: ${label}`);
  }

} finally {
  try {
    await browser?.close();
  } finally {
    if (server.pid && server.exitCode === null) process.kill(-server.pid, 'SIGTERM');
  }
}
