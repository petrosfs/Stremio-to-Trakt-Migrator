import { test, type Page } from '@playwright/test';
import { connectTrakt, library, mockApis, setTraktKeys } from '../e2e/mocks';

const OUT = 'docs/screenshots/';
const extra = [
  ['tt0133093', 'The Matrix', { flaggedWatched: 1, timesWatched: 2, lastWatched: '2024-02-10T20:00:00.000Z' }],
  ['tt0109830', 'Forrest Gump', { flaggedWatched: 1, timesWatched: 1, lastWatched: '2023-08-01T20:00:00.000Z' }],
  ['tt0245429', 'Spirited Away', {}],
  ['tt0114709', 'Toy Story', { timeOffset: 2400000, duration: 4860000, lastWatched: '2024-09-01T18:00:00.000Z' }],
  ['tt6751668', 'Parasite', {}],
  ['tt0110912', 'Pulp Fiction', { flaggedWatched: 1, timesWatched: 1, lastWatched: '2022-05-05T21:00:00.000Z' }],
].map(([_id, name, state]) => ({ _id, name, type: 'movie', state }));
const lib = [...library, ...extra];

const hues = [210, 260, 330, 20, 160, 45, 190, 290];
async function posters(page: Page) {
  await page.route('https://images.metahub.space/**', (r) => {
    const id = new URL(r.request().url()).pathname.split('/')[3] || 'x';
    const h = hues[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % hues.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,45%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},60%,25%)"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/></svg>`;
    return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
  });
}

/** Grows the viewport to the whole page, so the full-height sidebar is captured too. */
async function tall(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: h });
  await page.waitForTimeout(400);
  await page.screenshot({ path });
}

async function setup(page: Page, opts: any, dark: boolean) {
  await mockApis(page, { library: lib, likes: { tt0111161: 'loved', tt0133093: 'liked' }, ...opts });
  await posters(page);
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.goto('./');
  await setTraktKeys(page);
  await connectTrakt(page);
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByLabel('Κωδικός').fill('secret');
  await page.getByRole('button', { name: 'Σύνδεση & φόρτωση' }).click();
  await page.getByTestId('stremio-user').waitFor();
  await page.getByTestId('log').getByText('Likes:').waitFor();
}

test.describe('readme', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 });

  for (const dark of [false, true]) {
    test(`overview ${dark ? 'dark' : 'light'}`, async ({ page }) => {
      await setup(page, { traktExisting: true }, dark);
      await page.getByRole('button', { name: 'Έλεγχος στο Trakt' }).click();
      await page.getByTestId('plan').locator('td', { hasText: 'History' }).first().waitFor();
      await tall(page, `${OUT}overview-${dark ? 'dark' : 'light'}.png`);
    });
  }

  test('items', async ({ page }) => {
    await setup(page, { traktExisting: true }, true);
    await page.getByTestId('stat-history').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}items.png` });
  });

  test('reverse', async ({ page }) => {
    await setup(page, { traktReverse: true }, true);
    await page.getByTestId('mode-toStremio').click();
    await page.getByTestId('rev-check').click();
    await page.getByTestId('reverse-plan').waitFor();
    await page.getByTestId('rev-sec-library').getByLabel('Interstellar').uncheck();
    await tall(page, `${OUT}trakt-to-stremio.png`);
  });

  test('mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, {}, true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}mobile.png` });
  });
});
