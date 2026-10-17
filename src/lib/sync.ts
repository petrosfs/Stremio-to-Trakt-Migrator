import { TraktClient, TraktError, sleep } from './trakt';
import type { Category, Destination, StremioItem } from '../types';

// ---------- Endpoints ----------

export function endpointFor(dest: Destination, remove = false): string {
  const base =
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
  if (dest === 'history') {
    add(await client.getAll('/sync/history/movies', 100, signal), 'movie');
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
export function buildBody(items: StremioItem[], withDates: boolean) {
  const date = (x: StremioItem) => (withDates && x.watchedAt ? { watched_at: x.watchedAt } : {});
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
  const result: SyncResult = { added: 0, existing: 0, notFound: [], failedBatches: 0, sent: [] };
  const path = endpointFor(dest, remove);
  const withDates = dest === 'history' && !remove;

  for (let i = 0; i < items.length; i += chunkSize) {
    if (signal?.aborted) break;
    const chunk = items.slice(i, i + chunkSize);
    const started = Date.now();
    try {
      const r = await client.request<any>('POST', path, buildBody(chunk, withDates));
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
