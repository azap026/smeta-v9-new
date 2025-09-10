import { test, expect } from '@playwright/test';

test.describe('Главная страница', () => {
  test('отображается корректно', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await expect(page.locator('#webcrumbs')).toBeVisible();
    await page.screenshot({ path: 'screenshots/home.png' });
  });
});
