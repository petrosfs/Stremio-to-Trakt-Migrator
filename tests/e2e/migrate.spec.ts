import { expect, test } from '@playwright/test';
import { connectTrakt, mockApis, setTraktKeys } from './mocks';

test.describe('full migration', () => {
  test('Stremio account → check → transfer → undo', async ({ page }) => {
    const rec = await mockApis(page, { traktExisting: true });
    await page.goto('./');

    await setTraktKeys(page);

    // Wrong password shows the Stremio error and keeps the form.
    await page.getByLabel('Email').fill('me@example.com');
    await page.getByLabel('Κωδικός').fill('nope');
    await page.getByRole('button', { name: 'Σύνδεση & φόρτωση' }).click();
    await expect(page.getByTestId('log')).toContainText('Wrong password');
    await expect(page.getByTestId('stremio-user')).toHaveCount(0);

    await page.getByLabel('Κωδικός').fill('secret');
    await page.getByRole('button', { name: 'Σύνδεση & φόρτωση' }).click();
    await expect(page.getByTestId('stremio-user')).toHaveText('me@example.com');

    // Classification: removed/temp, decoded episodes, current episode.
    await expect(page.getByTestId('stat-collection')).toContainText('5');
    await expect(page.getByTestId('stat-watchlist')).toContainText('2');
    await expect(page.getByTestId('stat-history')).toContainText('7');
    await expect(page.getByTestId('stat-continueWatching')).toContainText('2');
    await expect(page.getByTestId('log')).toContainText('1 χωρίς IMDB');

    await connectTrakt(page);

    // Deselect "The Godfather" in Continue Watching.
    await page.getByTestId('stat-continueWatching').click();
    await page.getByLabel('The Godfather').uncheck();
    await expect(page.getByTestId('selected-count')).toHaveText('1/2 επιλεγμένα');

    // Search works.
    await page.getByTestId('stat-history').click();
    await page.getByPlaceholder('Αναζήτηση…').fill('breaking');
    await expect(page.getByTestId('selected-count')).toHaveText('5/5 επιλεγμένα');

    // Check against Trakt: 1 movie + 2 episodes (2 pages) already in history.
    await page.getByRole('button', { name: 'Έλεγχος στο Trakt' }).click();
    const plan = page.getByTestId('plan');
    await expect(plan.locator('tr', { hasText: 'History' })).toContainText(/7\s*3\s*4/);
    await expect(page.getByText('υπάρχει στο Trakt').first()).toBeVisible();

    await page.getByRole('button', { name: 'Μεταφορά τώρα' }).click();
    await expect(page.getByText('Ολοκληρώθηκε!').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('progress')).toHaveText('100%');

    const history = rec.posts.find((p) => p.path === '/sync/history')!.body;
    expect(history.movies).toEqual([{ ids: { imdb: 'tt0816692' }, watched_at: '2023-11-11T21:00:00.000Z' }]);
    expect(history.shows).toEqual([
      {
        ids: { imdb: 'tt0903747' },
        seasons: [
          {
            number: 1,
            episodes: [
              { number: 3, watched_at: '2010-01-03T00:00:00.000Z' },
              { number: 4, watched_at: '2010-01-04T00:00:00.000Z' },
              { number: 5, watched_at: '2024-06-10T19:00:00.000Z' },
            ],
          },
        ],
      },
    ]);
    const watchlistPosts = rec.posts.filter((p) => p.path === '/sync/watchlist').map((p) => p.body);
    expect(watchlistPosts).toEqual([
      { movies: [{ ids: { imdb: 'tt1375666' } }], shows: [{ ids: { imdb: 'tt0903747' } }] },
      { movies: [], shows: [{ ids: { imdb: 'tt4574334' }, seasons: [{ number: 1, episodes: [{ number: 3 }] }] }] },
    ]);

    // Undo removes exactly what was added.
    const undo = page.getByRole('button', { name: 'Αναίρεση τελευταίας μεταφοράς' });
    await undo.click();
    await page.getByRole('button', { name: 'Πάτα ξανά για επιβεβαίωση' }).click();
    await expect(page.getByTestId('log')).toContainText('Αναίρεση: αφαιρέθηκαν 7 στοιχεία');
    const removes = rec.posts.filter((p) => p.path.endsWith('/remove')).map((p) => p.path);
    expect(removes).toEqual(['/sync/history/remove', '/sync/watchlist/remove', '/sync/watchlist/remove']);
    expect(rec.posts.find((p) => p.path === '/sync/history/remove')!.body.movies).toEqual([{ ids: { imdb: 'tt0816692' } }]);
    await expect(undo).toHaveCount(0);

    // Sessions survive a reload.
    await page.reload();
    await expect(page.getByTestId('stremio-user')).toHaveText('me@example.com');
    await expect(page.getByText('petros').first()).toBeVisible();
  });

  test('skip-existing off sends everything without checking', async ({ page }) => {
    const rec = await mockApis(page, { traktExisting: true });
    await page.goto('./');
    await setTraktKeys(page);
    await connectTrakt(page);
    await page.getByLabel('Email').fill('me@example.com');
    await page.getByLabel('Κωδικός').fill('secret');
    await page.getByRole('button', { name: 'Σύνδεση & φόρτωση' }).click();
    await expect(page.getByTestId('stat-history')).toContainText('7');
    await page.getByText('Παράλειψη όσων υπάρχουν ήδη στο Trakt').click();
    await page.getByTestId('dest-watchlist').selectOption('skip');
    await page.getByTestId('dest-continue').selectOption('42');
    await page.getByRole('button', { name: 'Μεταφορά τώρα' }).click();
    await expect(page.getByText('Ολοκληρώθηκε!').first()).toBeVisible({ timeout: 20_000 });
    expect(rec.posts.map((p) => p.path)).toEqual(['/users/me/lists/42/items', '/sync/history']);
    expect(rec.posts[1].body.movies).toHaveLength(2);
  });
});

test('passwordless Stremio link', async ({ page }) => {
  const rec = await mockApis(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Σύνδεση χωρίς κωδικό' }).click();
  await expect(page.getByText('AB12', { exact: true })).toBeVisible();
  await expect(page.getByTestId('stremio-user')).toHaveText('linked@example.com', { timeout: 15_000 });
  await expect(page.getByTestId('stat-collection')).toContainText('5');
  expect(rec.linkReads).toBe(2);
});

test('Trakt sign-in can be cancelled and polling stops', async ({ page }) => {
  const rec = await mockApis(page);
  await page.goto('./');
  await setTraktKeys(page);
  await page.getByTestId('trakt-connect').click();
  await page.getByText('TRAKT123', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ακύρωση' }).click();
  await expect(page.getByTestId('log')).toContainText('Η σύνδεση ακυρώθηκε');
  const polls = rec.tokenPolls;
  await page.waitForTimeout(2500);
  expect(rec.tokenPolls).toBe(polls);
});
