import { test, expect } from '@playwright/test';

test.describe('Главная страница', () => {
  test('отображается корректно', async ({ page }) => {
    // Log browser console to aid debugging if the app fails to mount
    page.on('console', (msg) => {
      // Only surface errors and warnings to keep output terse
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[browser:${msg.type()}]`, msg.text());
      }
    });

    await page.goto('/');

    // Wait until React mounts something under #root
    await page.waitForFunction(() => {
      const r = document.querySelector('#root');
      return !!(r && r.firstElementChild);
    }, { timeout: 15000 });

    // Now check our app wrapper exists and is visible
    await expect(page.locator('#webcrumbs')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'screenshots/home.png' });
  });
});
