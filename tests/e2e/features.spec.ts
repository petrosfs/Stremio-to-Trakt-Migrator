import { expect, test, type Page } from '@playwright/test';
import { decodeWatched } from '../../src/lib/bitfield';
import { connectTrakt, library, mockApis, setTraktKeys } from './mocks';

async function stremioLogin(page: Page) {
  await page.getByLabel('Email').fill('me@example.com');
  await page.getByLabel('Κωδικός').fill('secret');
  await page.getByRole('button', { name: 'Σύνδεση & φόρτωση' }).click();
  await expect(page.getByTestId('stremio-user')).toHaveText('me@example.com');
}

test('likes → Trakt ratings, repeat plays, then only what is new', async ({ page }) => {
  const lib = library.map((x) => (x._id === 'tt0111161' ? { ...x, state: { ...x.state, timesWatched: 3 } } : x));
  const rec = await mockApis(page, { library: lib, likes: { tt0111161: 'loved', tt0068646: 'liked' } });
  await page.goto('./');
  await setTraktKeys(page);
  await connectTrakt(page);
  await stremioLogin(page);
  await expect(page.getByTestId('log')).toContainText('Likes: 2');

  for (const f of ['library', 'watchlist', 'continue']) await page.getByTestId(`dest-${f}`).selectOption('skip');
  await expect(page.getByTestId('dest-rated')).toHaveValue('ratings');
  await page.getByRole('button', { name: 'Μεταφορά τώρα' }).click();
  await expect(page.getByText('Ολοκληρώθηκε!').first()).toBeVisible({ timeout: 20_000 });

  const ratings = rec.posts.find((p) => p.path === '/sync/ratings')!.body;
  expect(ratings.movies).toEqual([
    { ids: { imdb: 'tt0111161' }, rating: 9 },
    { ids: { imdb: 'tt0068646' }, rating: 7 },
  ]);
  // Three plays: the last one with its real date, the earlier ones on the release date.
  const shawshank = rec.posts
    .find((p) => p.path === '/sync/history')!
    .body.movies.filter((m: any) => m.ids.imdb === 'tt0111161')
    .map((m: any) => m.watched_at)
    .sort();
  expect(shawshank).toEqual(['1994-09-23T00:00:00.000Z', '1994-09-23T00:01:00.000Z', '2024-03-01T20:00:00.000Z']);

  // Nothing changed since: the incremental option leaves nothing to send.
  await page.getByRole('button', { name: 'Νέα μεταφορά' }).click();
  await page.getByTestId('only-new').check();
  await expect(page.getByText('Δεν υπάρχει κάτι για αποστολή.')).toBeVisible();
});

test('Trakt → Stremio: preview, backup, write, undo', async ({ page }) => {
  const rec = await mockApis(page, { traktReverse: true, likes: { tt0068646: 'liked' } });
  await page.goto('./');
  await setTraktKeys(page);
  await connectTrakt(page);
  await stremioLogin(page);

  const card = page.getByTestId('reverse');
  await card.getByRole('button', { name: 'Τι λείπει από το Stremio' }).click();
  const plan = page.getByTestId('reverse-plan');
  await expect(plan).toContainText('Στη βιβλιοθήκη');
  await expect(plan.locator('summary', { hasText: 'Στη βιβλιοθήκη' })).toContainText('1');
  await expect(plan.locator('summary', { hasText: 'Ταινίες' })).toContainText('1');
  await expect(plan.locator('summary', { hasText: 'Επεισόδια' })).toContainText('1 σε 1 σειρές');
  await expect(plan.locator('summary', { hasText: 'Likes' })).toContainText('2');
  // Nothing has been written yet.
  expect(rec.puts).toEqual([]);

  const apply = page.getByTestId('rev-apply');
  await expect(apply).toContainText('(5)');
  await apply.click();
  const download = page.waitForEvent('download');
  await apply.click();
  expect((await download).suggestedFilename()).toMatch(/^stremio_library_backup_.*\.json$/);
  await expect(page.getByTestId('log')).toContainText('Το Stremio ενημερώθηκε: 3 στοιχεία, 2 likes.');

  const changes = rec.puts[0];
  const byId = Object.fromEntries(changes.map((c: any) => [c._id, c]));
  expect(Object.keys(byId).sort()).toEqual(['tt0903747', 'tt1160419', 'tt1375666']);
  expect(byId.tt1160419).toMatchObject({ name: 'Dune', type: 'movie', removed: false, temp: false });
  expect(byId.tt1375666.state).toMatchObject({ flaggedWatched: 1, timesWatched: 2, lastWatched: '2023-02-02T20:00:00.000Z' });
  const bbIds = Array.from({ length: 9 }, (_, i) => `tt0903747:1:${i + 1}`);
  expect(decodeWatched(byId.tt0903747.state.watched, bbIds)).toEqual([true, true, true, true, true, false, true, false, false]);
  expect(rec.likesSent).toEqual([
    { authToken: 'stremio-key', mediaId: 'tt0111161', mediaType: 'movie', status: 'loved' },
    { authToken: 'stremio-key', mediaId: 'tt0903747', mediaType: 'series', status: 'loved' },
  ]);

  // The library is reloaded with the new item.
  await expect(page.getByTestId('stat-collection')).toContainText('6');

  // Undo puts everything back and clears the likes.
  await page.getByTestId('rev-undo').click();
  await page.getByTestId('rev-undo').click();
  await expect(page.getByTestId('log')).toContainText('Αναιρέθηκαν 5 αλλαγές στο Stremio.');
  const undo = Object.fromEntries(rec.puts[1].map((c: any) => [c._id, c]));
  expect(undo.tt1160419).toMatchObject({ removed: true, temp: false });
  expect(undo.tt1375666.state).toEqual(library.find((x) => x._id === 'tt1375666')!.state);
  expect(undo.tt0903747.state.watched).toBe(library.find((x) => x._id === 'tt0903747')!.state.watched);
  expect(rec.likesSent.slice(2).map((l) => [l.mediaId, l.status])).toEqual([
    ['tt0111161', null],
    ['tt0903747', null],
  ]);
  await expect(page.getByTestId('stat-collection')).toContainText('5');
  await expect(page.getByTestId('rev-undo')).toHaveCount(0);
});
