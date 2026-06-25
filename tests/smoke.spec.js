const { test, expect } = require('@playwright/test');

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/مكاني|Makani/i);
});

test('spaces page loads', async ({ page }) => {
  await page.goto('/spaces/');
  await expect(page.locator('body')).toBeVisible();
});
