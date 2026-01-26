import { test, expect } from '@playwright/test';

/**
 * Smoke Tests
 *
 * Basic tests to verify the app loads and core navigation works.
 * These tests don't require funded wallets or network connectivity
 * beyond loading the app.
 */

test.describe('App Loading', () => {
  test('home page loads with create and restore buttons', async ({ page }) => {
    await page.goto('/');

    // Verify home page elements are visible
    await expect(page.getByTestId('create-wallet-button')).toBeVisible();
    await expect(page.getByTestId('restore-wallet-button')).toBeVisible();

    // Verify branding elements
    await expect(page.getByText('Glow')).toBeVisible();
    await expect(page.getByText('Powered by Breez SDK')).toBeVisible();
  });

  test('create wallet button navigates to generate page', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('create-wallet-button').click();

    // Should navigate away from home page
    // The URL or visible content should change
    // Wait for either URL change or content indicating we're on generate page
    await page.waitForTimeout(1000); // Allow for navigation

    // Verify we're no longer seeing the home page CTA buttons
    // (they might still be in DOM but hidden during transition)
    const createButton = page.getByTestId('create-wallet-button');
    await expect(createButton).not.toBeVisible({ timeout: 5000 });
  });

  test('restore wallet button shows mnemonic input', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('restore-wallet-button').click();

    // Should show restore page with mnemonic input
    await expect(page.getByTestId('mnemonic-input')).toBeVisible();
    await expect(page.getByTestId('restore-confirm-button')).toBeVisible();

    // The button should be disabled with empty input
    await expect(page.getByTestId('restore-confirm-button')).toBeDisabled();
  });

  test('restore page shows error for invalid mnemonic', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('restore-wallet-button').click();

    // Enter invalid mnemonic (not 12 or 24 words)
    await page.getByTestId('mnemonic-input').fill('invalid mnemonic phrase');
    await page.getByTestId('restore-confirm-button').click();

    // Should show error message
    await expect(
      page.getByText(/valid 12 or 24-word/i)
    ).toBeVisible();
  });

  test('restore page accepts 12-word mnemonic format', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('restore-wallet-button').click();

    // Enter a structurally valid 12-word phrase (doesn't need to be real)
    const testMnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    await page.getByTestId('mnemonic-input').fill(testMnemonic);

    // Button should be enabled
    await expect(page.getByTestId('restore-confirm-button')).toBeEnabled();

    // Note: We don't click submit here as it would try to connect to network
    // This just verifies the input validation works
  });
});

test.describe('Navigation', () => {
  test('back button on restore page returns to home', async ({ page }) => {
    await page.goto('/');

    // Go to restore page
    await page.getByTestId('restore-wallet-button').click();
    await expect(page.getByTestId('mnemonic-input')).toBeVisible();

    // Click back button (usually in header)
    const backButton = page.getByRole('button', { name: /back/i }).or(
      page.locator('[aria-label*="back" i]')
    );

    if (await backButton.isVisible()) {
      await backButton.click();

      // Should be back on home page
      await expect(page.getByTestId('create-wallet-button')).toBeVisible();
    }
  });
});

test.describe('Responsive Design', () => {
  test('app renders correctly on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');

    // Buttons should still be visible and clickable
    await expect(page.getByTestId('create-wallet-button')).toBeVisible();
    await expect(page.getByTestId('restore-wallet-button')).toBeVisible();

    // Verify buttons are properly sized for mobile (not cut off)
    const createButton = page.getByTestId('create-wallet-button');
    const boundingBox = await createButton.boundingBox();

    expect(boundingBox).not.toBeNull();
    if (boundingBox) {
      // Button should have reasonable width for mobile
      expect(boundingBox.width).toBeGreaterThan(100);
      // Button should be within viewport
      expect(boundingBox.x + boundingBox.width).toBeLessThanOrEqual(375);
    }
  });

  test('app renders correctly on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto('/');

    await expect(page.getByTestId('create-wallet-button')).toBeVisible();
    await expect(page.getByTestId('restore-wallet-button')).toBeVisible();
  });
});
