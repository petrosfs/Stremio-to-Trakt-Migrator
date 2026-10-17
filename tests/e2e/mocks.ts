import type { Page, Route } from '@playwright/test';

export const WATCHED_1_TO_5 = 'eJyTZwAAAEAAIA=='; // bits 0..4 set (stremio-core test vector)

export const library = [
  { _id: 'tt0111161', name: 'The Shawshank Redemption', type: 'movie', state: { flaggedWatched: 1, lastWatched: '2024-03-01T20:00:00.000Z', timesWatched: 1 } },
  { _id: 'tt0068646', name: 'The Godfather', type: 'movie', state: { timeOffset: 3600000, duration: 10000000, lastWatched: '2024-05-02T21:00:00.000Z' } },
  { _id: 'tt1375666', name: 'Inception', type: 'movie', state: {} },
  { _id: 'tt0816692', name: 'Interstellar', type: 'movie', removed: true, state: { timesWatched: 1, lastWatched: '2023-11-11T21:00:00.000Z' } },
  { _id: 'tt0903747', name: 'Breaking Bad', type: 'series', state: { watched: `tt0903747:1:5:5:${WATCHED_1_TO_5}`, lastWatched: '2024-06-10T19:00:00.000Z' } },
  { _id: 'tt4574334', name: 'Stranger Things', type: 'series', state: { timeOffset: 1000000, duration: 3000000, video_id: 'tt4574334:1:3', lastWatched: '2024-07-01T19:00:00.000Z' } },
  { _id: 'kitsu:1', name: 'Some Anime', type: 'series', state: {} },
];

const videos = (id: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${id}:1:${i + 1}`,
    season: 1,
    episode: i + 1,
    released: `2010-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    name: `Episode ${i + 1}`,
  }));

export interface Recorder {
  posts: { path: string; body: any }[];
  stremioBodies: any[];
  tokenPolls: number;
  tokenBodies: any[];
  paused: any[];
  deletes: string[];
  linkReads: number;
  /** Stremio datastorePut changes, one array per call. */
  puts: any[][];
  /** Bodies sent to likes.stremio.com/api/send. */
  likesSent: any[];
}

export interface MockOptions {
  traktExisting?: boolean;
  /** Trakt has watchlist, history and ratings for the Trakt → Stremio direction. */
  traktReverse?: boolean;
  /** Stremio like status per IMDB id. */
  likes?: Record<string, 'loved' | 'liked'>;
  /** Replaces the Stremio library. */
  library?: any[];
}

/** Trakt data used by the Trakt → Stremio tests. */
export const TRAKT_REVERSE: Record<string, any[]> = {
  '/sync/watchlist/movies': [{ movie: { title: 'Dune', ids: { imdb: 'tt1160419' } } }],
  '/sync/watchlist/shows': [{ show: { title: 'Breaking Bad', ids: { imdb: 'tt0903747' } } }],
  '/sync/history/movies': [
    { watched_at: '2022-01-01T20:00:00.000Z', movie: { title: 'Inception', ids: { imdb: 'tt1375666' } } },
    { watched_at: '2023-02-02T20:00:00.000Z', movie: { title: 'Inception', ids: { imdb: 'tt1375666' } } },
  ],
  '/sync/history/episodes': [
    { watched_at: '2024-08-01T20:00:00.000Z', episode: { season: 1, number: 7 }, show: { title: 'Breaking Bad', ids: { imdb: 'tt0903747' } } },
    { watched_at: '2024-01-01T20:00:00.000Z', episode: { season: 1, number: 1 }, show: { title: 'Breaking Bad', ids: { imdb: 'tt0903747' } } },
  ],
  '/sync/ratings/movies': [
    { rating: 10, movie: { title: 'The Shawshank Redemption', ids: { imdb: 'tt0111161' } } },
    { rating: 8, movie: { title: 'The Godfather', ids: { imdb: 'tt0068646' } } },
    { rating: 4, movie: { title: 'Inception', ids: { imdb: 'tt1375666' } } },
  ],
  '/sync/ratings/shows': [{ rating: 9, show: { title: 'Breaking Bad', ids: { imdb: 'tt0903747' } } }],
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export async function mockApis(page: Page, opts: MockOptions = {}): Promise<Recorder> {
  const rec: Recorder = { posts: [], stremioBodies: [], tokenPolls: 0, tokenBodies: [], paused: [], deletes: [], linkReads: 0, puts: [], likesSent: [] };
  // Server-side copy of the library: datastorePut changes it like Stremio does.
  let lib: any[] = structuredClone(opts.library || library);
  const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-Pagination-Page-Count', ...headers },
      body: JSON.stringify(body),
    });

  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://images.metahub.space/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));

  // ---- Stremio ----
  await page.route('https://api.strem.io/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON();
    rec.stremioBodies.push({ path, body });
    if (path === 'login') {
      if (body.password !== 'secret') return json(route, 200, { error: { code: 2, message: 'Wrong password' } });
      return json(route, 200, { result: { authKey: 'stremio-key', user: { email: body.email } } });
    }
    if (path === 'getUser') return json(route, 200, { result: { email: 'linked@example.com' } });
    if (path === 'datastoreGet') {
      if (body.authKey !== 'stremio-key') return json(route, 200, { error: { code: 1, message: 'Session does not exist' } });
      return json(route, 200, { result: lib });
    }
    if (path === 'datastorePut') {
      rec.puts.push(body.changes);
      for (const c of body.changes) lib = [...lib.filter((x) => x._id !== c._id), c];
      return json(route, 200, { result: { success: true } });
    }
    if (path === 'logout') return json(route, 200, { result: { success: true } });
    return json(route, 404, {});
  });
  await page.route('https://link.stremio.com/api/v2/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/create')) {
      return json(route, 200, { result: { success: true, code: 'AB12', link: 'https://link.stremio.com/AB12', qrcode: 'https://link.stremio.com/qr?data=x' } });
    }
    rec.linkReads++;
    if (rec.linkReads < 2) return json(route, 200, { error: { code: 101, message: 'Invalid or expired token' } });
    return json(route, 200, { result: { authKey: 'stremio-key' } });
  });
  await page.route('https://link.stremio.com/qr**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));

  // ---- Stremio likes ----
  await page.route('https://likes.stremio.com/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/get_status')) {
      if (url.searchParams.get('authToken') !== 'stremio-key') return json(route, 401, {});
      return json(route, 200, { status: opts.likes?.[url.searchParams.get('mediaId')!] ?? null });
    }
    rec.likesSent.push(route.request().postDataJSON());
    return json(route, 200, { success: true });
  });

  // ---- Cinemeta ----
  await page.route('https://v3-cinemeta.strem.io/**', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!.replace('.json', '');
    const metas: Record<string, any> = {
      tt0903747: { name: 'Breaking Bad', videos: videos('tt0903747', 9) },
      tt4574334: { name: 'Stranger Things', videos: videos('tt4574334', 8) },
      tt0111161: { name: 'The Shawshank Redemption', released: '1994-09-23T00:00:00.000Z' },
    };
    return metas[id] ? json(route, 200, { meta: metas[id] }) : json(route, 404, {});
  });

  // ---- Trakt ----
  const traktHandler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const page = Number(url.searchParams.get('page') || 1);
    if (p === '/oauth/device/code') {
      return json(route, 200, { device_code: 'dc', user_code: 'TRAKT123', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 1 });
    }
    if (p.startsWith('/oauth/') && url.hostname !== 'auth.trakt.tv') return json(route, 404, { error: 'use auth.trakt.tv' });
    if (p === '/oauth/device/token') {
      rec.tokenPolls++;
      rec.tokenBodies.push(req.postDataJSON());
      return rec.tokenPolls < 2
        ? json(route, 400, {})
        : json(route, 200, { access_token: 'at', refresh_token: 'rt', expires_in: 86400, created_at: Math.floor(Date.now() / 1000) });
    }
    if (p === '/oauth/revoke') return json(route, 200, {});
    if (req.headers()['authorization'] !== 'Bearer at') return json(route, 401, {});
    if (p === '/users/me') return json(route, 200, { username: 'petros' });
    if (p === '/users/me/lists') return json(route, 200, [{ name: 'From Stremio', ids: { trakt: 42 } }]);

    if (req.method() === 'DELETE') {
      rec.deletes.push(p);
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    if (req.method() === 'GET' && p.startsWith('/search/imdb/')) {
      const imdb = p.split('/').pop()!;
      const type = url.searchParams.get('type');
      const traktIds: Record<string, number> = { tt0068646: 238, tt4574334: 1393 };
      if (!traktIds[imdb]) return json(route, 200, []);
      return json(route, 200, [{ type, [type!]: { title: 'X', year: 2000, ids: { trakt: traktIds[imdb], imdb } } }]);
    }
    if (req.method() === 'GET' && /^\/shows\/\d+\/seasons\/\d+\/episodes\/\d+$/.test(p)) {
      const [, , show, , s, , e] = p.split('/');
      return json(route, 200, { season: Number(s), number: Number(e), ids: { trakt: Number(show) * 1000 + Number(s) * 100 + Number(e) } });
    }
    if (req.method() === 'GET' && p === '/sync/playback/movies') {
      return json(route, 200, rec.paused.filter((x) => x.type === 'movie'), { 'X-Pagination-Page-Count': '1' });
    }
    if (req.method() === 'GET' && p === '/sync/playback/episodes') {
      return json(route, 200, rec.paused.filter((x) => x.type === 'episode'), { 'X-Pagination-Page-Count': '1' });
    }
    if (req.method() === 'GET') {
      const pages = (items: any[][]) => json(route, 200, items[page - 1] || [], { 'X-Pagination-Page-Count': String(items.length) });
      if (opts.traktReverse) return pages([TRAKT_REVERSE[p] || []]);
      if (!opts.traktExisting) return pages([[]]);
      if (p === '/sync/history/movies') return pages([[{ type: 'movie', movie: { ids: { imdb: 'tt0111161' } } }]]);
      if (p === '/sync/history/episodes') {
        return pages([
          [{ type: 'episode', episode: { season: 1, number: 1 }, show: { ids: { imdb: 'tt0903747' } } }],
          [{ type: 'episode', episode: { season: 1, number: 2 }, show: { ids: { imdb: 'tt0903747' } } }],
        ]);
      }
      return pages([[]]);
    }

    const body = req.postDataJSON();
    rec.posts.push({ path: p, body });
    if (p === '/scrobble/pause') {
      const id = rec.paused.length + 1;
      if (body.movie) rec.paused.push({ id, type: 'movie', progress: body.progress, movie: { ids: { trakt: body.movie.ids.trakt, imdb: 'tt0068646' } } });
      if (body.episode) rec.paused.push({ id, type: 'episode', progress: body.progress, episode: { season: 1, number: 3, ids: body.episode.ids }, show: { ids: { imdb: 'tt4574334' } } });
      return json(route, 201, { id, action: 'pause', progress: body.progress });
    }
    const count = (b: any) => ({
      movies: b.movies?.length || 0,
      shows: (b.shows || []).filter((s: any) => !s.seasons).length,
      episodes: (b.shows || []).reduce((n: number, s: any) => n + (s.seasons || []).reduce((m: number, se: any) => m + se.episodes.length, 0), 0),
    });
    if (p.endsWith('/remove')) return json(route, 200, { deleted: count(body), not_found: { movies: [], shows: [] } });
    return json(route, 201, { added: count(body), existing: { movies: 0, shows: 0, episodes: 0 }, not_found: { movies: [], shows: [] } });
  };
  await page.route('https://api.trakt.tv/**', traktHandler);
  await page.route('https://auth.trakt.tv/**', traktHandler);

  return rec;
}

/** Saves Trakt keys through the settings dialog. */
export async function setTraktKeys(page: Page, secret?: string) {
  await page.getByTestId('keys').click();
  const dialog = page.getByRole('dialog');
  // Redirect URI shown for the Trakt app is this page's https/http address, not the OOB urn.
  await dialog.getByText('http://localhost:4173/', { exact: true }).waitFor();
  await dialog.locator('input').first().fill('client_id_1234567890');
  if (secret) await dialog.locator('input[type=password]').fill(secret);
  await dialog.locator('button[type=submit]').click();
}

export async function connectTrakt(page: Page) {
  await page.getByTestId('trakt-connect').click();
  await page.getByText('TRAKT123', { exact: true }).waitFor();
  await page.getByText('petros').first().waitFor({ timeout: 15_000 });
}
