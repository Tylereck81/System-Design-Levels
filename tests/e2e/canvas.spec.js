import { test, expect } from '../fixtures.js';
import { freshPage, openMission, buildBasic, center } from '../helpers.js';

// The desktop canvas: a wider view and zoom from 100% out to 70%. The layout around it is in build-layout.spec.js.

const viewBox = (page) => page.locator('#cv').evaluate((cv) => cv.getAttribute('viewBox').split(' ').map(Number));

test.describe('Canvas · zoom and layout', () => {
  test('zoom steps from 100% out to 70% and back, showing more of the design area', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshPage(page, '#level-5/build');
    await expect(page.locator('#zoomPct')).toHaveText('100%');
    await expect(page.locator('#zoomIn')).toBeDisabled();
    const at100 = await viewBox(page);
    await page.click('#zoomOut');
    await expect(page.locator('#zoomPct')).toHaveText('85%');
    const at85 = await viewBox(page);
    expect(at85[2]).toBeGreaterThan(at100[2]);
    await page.click('#zoomOut');
    await expect(page.locator('#zoomPct')).toHaveText('70%');
    await expect(page.locator('#zoomOut')).toBeDisabled();
    expect((await viewBox(page))[2]).toBeCloseTo(at100[2] / 0.7, 0);
    await page.click('#zoomIn');
    await expect(page.locator('#zoomPct')).toHaveText('85%');
  });

  test('zooming in is refused while a component would leave the view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshPage(page, '#level-5/build');
    await page.click('#zoomOut'); await page.click('#zoomOut');
    const vb = await viewBox(page);
    // Put the DNS box near the left edge of the 70% view, outside what 85% shows.
    await page.evaluate((x) => { const s = window.__sdl; s.S.nodes.find((n) => n.type === 'dns').x = x; s.afterChange(); }, vb[0] + 100);
    await expect(page.locator('#zoomPct')).toHaveText('70%');
    await expect(page.locator('#zoomIn')).toBeDisabled();
    await page.click('#zoomIn', { force: true });
    await expect(page.locator('#zoomPct')).toHaveText('70%');
  });

  test('the view zooms out by itself when a component is outside it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshPage(page, '#level-5/build');
    const vb = await viewBox(page);
    await page.evaluate((x) => { const s = window.__sdl; s.S.nodes.find((n) => n.type === 'dns').x = x; s.afterChange(true); }, vb[0] - 60);
    await expect(page.locator('#zoomPct')).not.toHaveText('100%');
    const dns = await page.evaluate(() => window.__sdl.S.nodes.find((n) => n.type === 'dns').id);
    const [cv, box] = await Promise.all([page.locator('#cv').boundingBox(), page.locator(`[data-node="${dns}"] .node-box`).boundingBox()]);
    expect(box.x).toBeGreaterThanOrEqual(cv.x);
  });

  test('phones keep their fitted view and hide the zoom controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-5/build');
    await expect(page.locator('.zoom')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

// Request dots must stay on their connection lines when the design is moved while the run is paused.
test.describe('Canvas · dots while paused', () => {
  // Each live dot's distance to the nearest connection line. A dot resting at a component sits up to ~10 px off it.
  const offLine = (page) => page.evaluate(() => {
    const lines = [...document.querySelectorAll('#edgesG .edge-line')].map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => +l.getAttribute(k)));
    const dist = (px, py, [x1, y1, x2, y2]) => {
      const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    };
    return [...document.querySelectorAll('#dotsG circle:not(.fail)')]
      .map((c) => Math.min(...lines.map((l) => dist(+c.getAttribute('cx'), +c.getAttribute('cy'), l))));
  });
  const dotsSnapshot = (page) => page.evaluate(() => [...document.querySelectorAll('#dotsG circle')].map((c) => c.getAttribute('cx') + ',' + c.getAttribute('cy')));

  async function pausedWithDots(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshPage(page, '#level-1/build');
    await openMission(page, 0);
    const ids = await buildBasic(page);
    await page.click('#playBtn');
    await page.waitForFunction(() => document.querySelectorAll('#dotsG circle:not(.fail)').length >= 3, null, { timeout: 8000 });
    await page.click('#playBtn');
    expect(await page.evaluate(() => window.__sdl.run.playing)).toBe(false);
    return ids;
  }

  test('dragging a component keeps the dots on the moved lines', async ({ page }) => {
    const ids = await pausedWithDots(page);
    const before = await dotsSnapshot(page);
    const a = await center(page, `[data-node="${ids.web}"] .node-box`);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 260, a.y - 60, { steps: 10 });
    expect(Math.max(...await offLine(page))).toBeLessThan(12);
    await page.mouse.up();
    expect(Math.max(...await offLine(page))).toBeLessThan(12);
    expect(await dotsSnapshot(page)).not.toEqual(before);
  });

  test('moving a component with the arrow keys keeps the dots on the moved lines', async ({ page }) => {
    const ids = await pausedWithDots(page);
    await page.focus(`[data-node="${ids.web}"]`);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
    expect(Math.max(...await offLine(page))).toBeLessThan(12);
  });
});
