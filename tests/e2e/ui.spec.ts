import { expect, test } from '@playwright/test';
import { library, mockApis } from './mocks';

test('file upload (JSON) and CSV export', async ({ page }) => {
  await mockApis(page);
  await page.goto('./');
  await page.getByRole('tab', { name: 'Αρχείο' }).or(page.getByRole('button', { name: 'Αρχείο' })).click();
  await page.getByTestId('file-input').setInputFiles({ name: 'library.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(library)) });
  await expect(page.getByTestId('stat-history')).toContainText('7');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Λήψη CSV' }).click()]);
  const csv = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(csv).toString('utf-8');
  expect(text.split('\n')[0]).toBe('imdb_id,type,watched_at,watchlisted_at,season,episode');
  expect(text).toContain('tt0903747,episode,2010-01-01T00:00:00.000Z,,1,1');
});

test('file upload (HTML page)', async ({ page }) => {
  await mockApis(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Αρχείο' }).click();
  const html = `<html><body>
    <a href="#/detail/movie/tt0111161" title="Shawshank"><div class="watched-icon-layer"></div></a>
    <a href="#/detail/series/tt0903747" title="Breaking Bad"><div class="progress-bar-layer"></div></a>
    <a href="#/detail/movie/tt1375666" title="Inception"></a></body></html>`;
  await page.getByTestId('file-input').setInputFiles({ name: 'library.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await expect(page.getByTestId('stat-collection')).toContainText('3');
  await expect(page.getByTestId('stat-history')).toContainText('1');
  await expect(page.getByTestId('stat-continueWatching')).toContainText('1');
});

test('language switch to English and back', async ({ page }) => {
  await mockApis(page);
  await page.goto('./');
  await expect(page.getByText('Βιβλιοθήκη Stremio').first()).toBeVisible();
  await page.getByTestId('lang').click();
  await expect(page.getByText('Stremio library').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.getByText('Stremio library').first()).toBeVisible();
  await page.getByTestId('lang').click();
  await expect(page.getByText('Βιβλιοθήκη Stremio').first()).toBeVisible();
});

test('no horizontal overflow and PWA manifest', async ({ page, request }) => {
  await mockApis(page);
  await page.goto('./');
  await page.getByLabel('Email').fill('me@example.com');
  await page.getByLabel('Κωδικός').fill('secret');
  await page.getByRole('button', { name: 'Σύνδεση & φόρτωση' }).click();
  await expect(page.getByTestId('stat-history')).toContainText('7');
  await page.getByTestId('stat-history').click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const manifest = await (await request.get('./manifest.webmanifest')).json();
  expect(manifest.short_name).toBe('Stremio2Trakt');
  // Version is shown discreetly in the footer, not in the app name.
  await expect(page.getByTestId('version')).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(page.getByText(/Stremio2Trakt v\d/i)).toHaveCount(0);
  expect(manifest.icons.length).toBe(3);
});
