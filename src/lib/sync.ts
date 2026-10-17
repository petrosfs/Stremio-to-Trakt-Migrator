import { TraktClient, TraktError, sleep } from './trakt';
import type { Category, Destination, StremioItem } from '../types';

// ---------- Endpoints ----------

/** Destination for in-progress items: Trakt playback progress (its own Continue Watching). */
export const PLAYBACK = 'playback';
/** Destination for Stremio likes: Trakt ratings. */
export const RATINGS = 'ratings';

export function endpointFor(dest: Destination, remove = false): string {
  const base =
    dest === RATINGS ? '/sync/ratings' :
    dest === 'history' ? '/sync/history' :
    dest === 'watchlist' ? '/sync/watchlist' :
    `/users/me/lists/${encodeURIComponent(dest)}/items`;
  return remove ? `${base}/remove` : base;
}

/** Keys comparable with StremioItem.key, built from Trakt objects. */
export function traktKey(entry: any): string | null {
  const type = entry?.type || (entry?.episode ? 'episode' : entry?.movie ? 'movie' : entry?.show ? 'show' : null);
  if (type === 'movie') return entry.movie?.ids?.imdb ? `movie:${entry.movie.ids.imdb}` : null;
  if (type === 'show') return entry.show?.ids?.imdb ? `show:${entry.show.ids.imdb}` : null;
  if (type === 'episode') {
    const imdb = entry.show?.ids?.imdb;
    const s = entry.episode?.season;
    const e = entry.episode?.number;
    return imdb && s !== undefined && e !== undefined ? `${imdb}:${s}:${e}` : null;
  }
  return null;
}

/** Fetches what already exists in a destination, as a set of item keys. */
export async function existingKeys(client: TraktClient, dest: Destination, signal?: AbortSignal): Promise<Set<string>> {
  const keys = new Set<string>();
  const add = (entries: any[], forceType?: string) => {
    for (const e of entries) {
      const k = traktKey(forceType ? { ...e, type: forceType } : e);
      if (k) keys.add(k);
    }
  };
  if (dest === PLAYBACK) {
    add(await client.getAll('/sync/playback/movies', 100, signal), 'movie');
    add(await client.getAll('/sync/playback/episodes', 100, signal), 'episode');
  } else if (dest === RATINGS) {
    add(await client.getAll('/sync/ratings/movies', 100, signal), 'movie');
    add(await client.getAll('/sync/ratings/shows', 100, signal), 'show');
  } else if (dest === 'history') {
    // Every play counts: the 2nd play of a movie is "movie:tt…#2" (see repeat plays).
    const plays = new Map<string, number>();
    for (const e of await client.getAll<any>('/sync/history/movies', 100, signal)) {
      const k = traktKey({ ...e, type: 'movie' });
      if (!k) continue;
      const n = (plays.get(k) || 0) + 1;
      plays.set(k, n);
      keys.add(n === 1 ? k : `${k}#${n}`);
    }
    add(await client.getAll('/sync/history/episodes', 100, signal), 'episode');
  } else if (dest === 'watchlist') {
    add(await client.getAll('/sync/watchlist/movies', 100, signal), 'movie');
    add(await client.getAll('/sync/watchlist/shows', 100, signal), 'show');
    add(await client.getAll('/sync/watchlist/episodes', 100, signal), 'episode');
  } else {
    add(await client.getAll(`/users/me/lists/${encodeURIComponent(dest)}/items`, 100, signal));
  }
  return keys;
}

// ---------- Plan ----------

export interface PlanStep {
  cat: Category;
  label: string;
  dest: Destination;
  /** Selected items for this step. */
  items: StremioItem[];
  /** Items to send (selected minus already existing, when known). */
  toSend: StremioItem[];
  /** Selected items already in the destination (null = not checked yet). */
  existing: number | null;
}

export function applyExisting(items: StremioItem[], existing: Set<string> | undefined) {
  if (!existing) return { toSend: items, existing: null };
  const toSend = items.filter((i) => !existing.has(i.key));
  return { toSend, existing: items.length - toSend.length };
}

// ---------- Body ----------

/** Builds a Trakt sync body. watched_at is only sent for history. */
export function buildBody(items: StremioItem[], withDates: boolean, withRatings = false) {
  const date = (x: StremioItem) => ({
    ...(withDates && x.watchedAt ? { watched_at: x.watchedAt } : {}),
    ...(withRatings && x.rating ? { rating: x.rating } : {}),
  });
  const shows: Record<string, any> = {};
  const showList: any[] = [];

  for (const x of items.filter((i) => i.type === 'show')) {
    showList.push({ ids: { imdb: x.id }, ...date(x) });
  }
  for (const x of items.filter((i) => i.type === 'episode')) {
    let show = shows[x.id];
    if (!show) {
      show = shows[x.id] = { ids: { imdb: x.id }, seasons: [] };
      showList.push(show);
    }
    let season = show.seasons.find((s: any) => s.number === x.season);
    if (!season) {
      season = { number: x.season, episodes: [] };
      show.seasons.push(season);
    }
    season.episodes.push({ number: x.episode, ...date(x) });
  }

  return {
    movies: items.filter((i) => i.type === 'movie').map((x) => ({ ids: { imdb: x.id }, ...date(x) })),
    shows: showList,
  };
}

// ---------- Send / remove ----------

export interface SyncResult {
  added: number;
  existing: number;
  notFound: string[];
  failedBatches: number;
  /** Items Trakt accepted (used for undo). */
  sent: StremioItem[];
}

const sum = (o: any) => (o?.movies || 0) + (o?.shows || 0) + (o?.seasons || 0) + (o?.episodes || 0);

function notFoundKeys(r: any): string[] {
  const out: string[] = [];
  for (const m of r?.not_found?.movies || []) if (m?.ids?.imdb) out.push(`movie:${m.ids.imdb}`);
  for (const s of r?.not_found?.shows || []) {
    const imdb = s?.ids?.imdb;
    if (!imdb) continue;
    if (Array.isArray(s.seasons) && s.seasons.length) {
      for (const se of s.seasons) for (const ep of se.episodes || []) out.push(`${imdb}:${se.number}:${ep.number}`);
    } else out.push(`show:${imdb}`);
  }
  for (const e of r?.not_found?.episodes || []) if (e?.ids?.imdb) out.push(`episode:${e.ids.imdb}`);
  return out;
}

/** Sends items in chunks, about one write request per second (Trakt limit). */
export async function sendItems(
  client: TraktClient,
  dest: Destination,
  items: StremioItem[],
  opts: { remove?: boolean; onProgress?: (done: number) => void; signal?: AbortSignal; chunkSize?: number } = {},
): Promise<SyncResult> {
  const { remove = false, onProgress, signal, chunkSize = 100 } = opts;
  if (dest === PLAYBACK) return remove ? removePlayback(client, items, onProgress) : sendPlayback(client, items, onProgress, signal);
  const result: SyncResult = { added: 0, existing: 0, notFound: [], failedBatches: 0, sent: [] };
  const path = endpointFor(dest, remove);
  const withDates = dest === 'history' && !remove;
  const withRatings = dest === RATINGS && !remove;

  for (let i = 0; i < items.length; i += chunkSize) {
    if (signal?.aborted) break;
    const chunk = items.slice(i, i + chunkSize);
    const started = Date.now();
    try {
      const r = await client.request<any>('POST', path, buildBody(chunk, withDates, withRatings));
      result.added += sum(remove ? r?.deleted : r?.added);
      result.existing += sum(r?.existing);
      const nf = notFoundKeys(r);
      result.notFound.push(...nf);
      const nfSet = new Set(nf);
      result.sent.push(...chunk.filter((c) => !nfSet.has(c.key)));
    } catch (e) {
      if (e instanceof TraktError && e.status === 401) throw e;
      result.failedBatches++;
    }
    onProgress?.(chunk.length);
    const wait = 1100 - (Date.now() - started);
    if (wait > 0 && i + chunkSize < items.length) await sleep(wait);
  }
  return result;
}

// ---------- Playback progress ----------

/**
 * Trakt keeps "Continue Watching" as playback progress, which apps set with
 * /scrobble/pause (it never adds a play to History). The scrobble body needs Trakt's
 * own ids, so each item is first looked up with /search/imdb/:id.
 * Progress is capped below 80% because a stop above that counts as watched.
 */
const MAX_PROGRESS = 79;

async function lookupTrakt(client: TraktClient, item: StremioItem): Promise<any | null> {
  const type = item.type === 'movie' ? 'movie' : 'show';
  const res = await client.request<any[]>('GET', `/search/imdb/${encodeURIComponent(item.id)}?type=${type}`);
  const hit = (res || []).find((r) => r?.type === type)?.[type];
  if (!hit) return null;
  if (item.type === 'movie') return { movie: { title: hit.title, year: hit.year, ids: { trakt: hit.ids?.trakt } } };
  const ep = await client
    .request<any>('GET', `/shows/${hit.ids?.trakt}/seasons/${item.season}/episodes/${item.episode}`)
    .catch(() => null);
  return ep?.ids?.trakt ? { episode: { ids: { trakt: ep.ids.trakt } } } : null;
}

export async function sendPlayback(
  client: TraktClient,
  items: StremioItem[],
  onProgress?: (done: number) => void,
  signal?: AbortSignal,
): Promise<SyncResult> {
  const result: SyncResult = { added: 0, existing: 0, notFound: [], failedBatches: 0, sent: [] };
  for (const item of items) {
    if (signal?.aborted) break;
    const started = Date.now();
    // Only movies and episodes with a known progress can be resumed.
    if ((item.type !== 'movie' && item.type !== 'episode') || !item.progress || item.progress < 1) {
      result.notFound.push(item.key);
      onProgress?.(1);
      continue;
    }
    try {
      const target = await lookupTrakt(client, item);
      if (!target) {
        result.notFound.push(item.key);
      } else {
        await client.request('POST', '/scrobble/pause', { ...target, progress: Math.min(item.progress, MAX_PROGRESS) });
        result.added++;
        result.sent.push(item);
      }
    } catch (e) {
      if (e instanceof TraktError && e.status === 401) throw e;
      result.failedBatches++;
    }
    onProgress?.(1);
    const wait = 1100 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  return result;
}

/** Removes the playback entries of the given items (used for undo). */
export async function removePlayback(
  client: TraktClient,
  items: StremioItem[],
  onProgress?: (done: number) => void,
): Promise<SyncResult> {
  const result: SyncResult = { added: 0, existing: 0, notFound: [], failedBatches: 0, sent: [] };
  const wanted = new Set(items.map((i) => i.key));
  const entries = [
    ...(await client.getAll<any>('/sync/playback/movies')).map((e) => ({ ...e, type: 'movie' })),
    ...(await client.getAll<any>('/sync/playback/episodes')).map((e) => ({ ...e, type: 'episode' })),
  ];
  for (const e of entries) {
    const key = traktKey(e);
    if (!key || !wanted.has(key) || !e.id) continue;
    try {
      await client.request('DELETE', `/sync/playback/${e.id}`);
      result.added++;
    } catch {
      result.failedBatches++;
    }
    onProgress?.(1);
  }
  return result;
}
