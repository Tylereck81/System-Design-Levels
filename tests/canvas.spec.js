import { test, expect } from '@playwright/test';
import { freshPage } from './helpers.js';

// The desktop canvas: a wider view, zoom from 100% out to 70%, and the layout around it.

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

  test('at 1440 px the canvas is wider, with the palette above it and the inspector above the mission', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshPage(page, '#level-5/build');
    const [cv, pal, insp, mission] = await Promise.all(['#cv', '.palette', '#insp', '#missionCard'].map((s) => page.locator(s).first().boundingBox()));
    expect(cv.width).toBeGreaterThan(950);
    expect(pal.y + pal.height).toBeLessThanOrEqual(cv.y);
    expect(insp.y).toBeLessThan(mission.y);
    expect(insp.x).toBeGreaterThan(cv.x + cv.width - 1);
  });

  test('phones keep their fitted view and hide the zoom controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-5/build');
    await expect(page.locator('.zoom')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
