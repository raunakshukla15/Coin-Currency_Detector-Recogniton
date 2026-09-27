import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://127.0.0.1:8000';

test.describe('CoinScan - Localhost Smoke Test', () => {

  // 1. Website loads
  test('1. Website loads', async ({ page }) => {
    const response = await page.goto(BASE_URL);

    expect(response).not.toBeNull();
    expect(response.status()).toBeLessThan(500);

    await expect(page).toHaveTitle(/CoinScan|Currency/i);

    console.log('✓ Website loaded');
  });


  // 2. Login page
  test('2. Login page loads correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);

    // Username / Email field
    await expect(
      page.locator('input').nth(0)
    ).toBeVisible();

    // Password field
    await expect(
      page.locator('input[type="password"]')
    ).toBeVisible();

    // Login button
    await expect(
      page.getByRole('button', { name: /log in/i })
    ).toBeVisible();

    // Sign up text/link
    await expect(
      page.getByText(/sign up/i).first()
    ).toBeVisible();

    console.log('✓ Login page loaded correctly');
  });


  // 3. Main routes
  test('3. Main pages do not crash', async ({ page }) => {
    const pages = [
      '/',
      '/login',
      '/history',
      '/collection',
      '/chatbot',
      '/contact',
      '/converter'
    ];

    for (const path of pages) {
      const response = await page.goto(`${BASE_URL}${path}`);

      expect(response).not.toBeNull();

      const status = response.status();

      console.log(`${path} → ${status}`);

      expect(status).toBeLessThan(500);
    }

    console.log('✓ Main pages responded successfully');
  });


  // 4. Homepage JavaScript errors
  test('4. No uncaught JavaScript errors on homepage', async ({ page }) => {
    const errors = [];

    page.on('pageerror', error => {
      errors.push(error.message);
    });

    await page.goto(BASE_URL);

    await page.waitForLoadState('networkidle');

    if (errors.length > 0) {
      console.log('\nJavaScript errors found:');

      for (const error of errors) {
        console.log(`  - ${error}`);
      }
    }

    expect(errors).toEqual([]);

    console.log('✓ No uncaught JavaScript errors');
  });


  // 5. Backend is reachable
  test('5. Backend is reachable', async ({ request }) => {

    // First check OpenAPI.
    // This also confirms that the FastAPI backend is actually running.
    const openapiResponse = await request.get(
      `${BACKEND_URL}/openapi.json`
    );

    expect(openapiResponse.status()).toBe(200);

    const openapi = await openapiResponse.json();

    expect(openapi.paths).toBeDefined();

    const paths = Object.keys(openapi.paths);

    console.log('\nBackend API paths found:');

    for (const path of paths) {
      console.log(`  ${path}`);
    }

    // Look for an actual health/status endpoint.
    const healthPath = paths.find(path =>
      /health|status/i.test(path)
    );

    if (healthPath) {
      console.log(`\nHealth endpoint found: ${healthPath}`);

      const healthResponse = await request.get(
        `${BACKEND_URL}${healthPath}`
      );

      console.log(
        `Health response: ${healthResponse.status()}`
      );

      expect(healthResponse.status()).toBe(200);

      console.log('✓ Backend health endpoint works');
    } else {
      // If the backend has no health endpoint, the OpenAPI
      // response itself proves that FastAPI is reachable.
      console.log(
        '\nNo explicit health endpoint found.'
      );

      console.log(
        '✓ Backend is reachable through /openapi.json'
      );
    }
  });

});