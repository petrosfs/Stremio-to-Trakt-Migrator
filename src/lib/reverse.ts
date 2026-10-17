import { decodeWatched, encodeWatched, parseWatchedField, sortVideos } from './bitfield';
import { posterFor, type LikeStatus, type SeriesMeta } from './stremio';
import type { TraktClient } from './trakt';

/**
 * Trakt → Stremio. Only adds: items join the library, get marked as watched, or get a
 * like. Nothing is ever removed or un-watched. Library items follow stremio-core's
 * LibraryItem format; `_mtime` is set to now so every Stremio app picks the change up.
 */

export interface TraktSide {
  watchlist: { id: string; type: 'movie' | 'series'; name: string }[];
  /** Watched movies: plays and last watched date. */
  movies: Record<string, { name: string; plays: number; last: string }>;
  /** Watched episodes per show: "season:episode" keys and last watched date. */
  shows: Record<string, { name: string; episodes: Set<string>; last: string }>;
  /** Trakt ratings 1-10 per IMDB id. */
  ratings: Record<string, { type: 'movie' | 'series'; name: string; rating: number }>;
}

export interface ReverseOptions {
  watchlist: boolean;
  watched: boolean;
  likes: boolean;
}

export interface Created {
  id: string;
  type: 'movie' | 'series';
  name: string;
}

export interface ReversePlan {
  /** Library items to write with datastorePut. */
  changes: any[];
  /** Previous versions of items that already existed (for undo). */
  originals: any[];
  /** Items created from scratch (for undo). */
  created: Created[];
  likes: { id: string; type: 'movie' | 'series'; name: string; status: LikeStatus }[];
  summary: {
    addedToLibrary: string[];
    moviesWatched: string[];
    episodesWatched: number;
    seriesUpdated: string[];
    seriesWithoutEpisodes: string[];
  };
}

/** Trakt rating → Stremio like (9–10 loved, 7–8 liked). */
export function likeForRating(rating: number): LikeStatus | null {
  if (rating >= 9) return 'loved';
  if (rating >= 7) return 'liked';
  return null;
}

const maxIso = (a?: string | null, b?: string | null) => (!a ? b || undefined : !b ? a : a > b ? a : b);

export function emptyState() {
  return {
    lastWatched: null,
    timeWatched: 0,
    timeOffset: 0,
    overallTimeWatched: 0,
    timesWatched: 0,
    flaggedWatched: 0,
    duration: 0,
    video_id: null,
    watched: null,
    noNotif: false,
  };
}

export function newLibraryItem(id: string, type: 'movie' | 'series', name: string, now: string, inLibrary: boolean) {
  return {
    _id: id,
    name,
    type,
    poster: posterFor(id).replace('/small/', '/medium/'),
    posterShape: 'poster',
    // Watched items that are not in the library live as removed+temp, like in Stremio itself.
    removed: !inLibrary,
    temp: !inLibrary,
    _ctime: now,
    _mtime: now,
    state: emptyState(),
    behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false },
  };
}

export function planReverse(
  library: any[],
  trakt: TraktSide,
  metas: Record<string, SeriesMeta>,
  currentLikes: Record<string, LikeStatus>,
  opts: ReverseOptions,
  now = new Date().toISOString(),
): ReversePlan {
  const byId = new Map<string, any>();
  for (const x of library) if (typeof x?._id === 'string') byId.set(x._id, x);

  const changed = new Map<string, any>();
  const originals: any[] = [];
  const created: Created[] = [];
  const summary: ReversePlan['summary'] = {
    addedToLibrary: [],
    moviesWatched: [],
    episodesWatched: 0,
    seriesUpdated: [],
    seriesWithoutEpisodes: [],
  };

  /** Working copy of an item (existing or new). */
  const working = (id: string, type: 'movie' | 'series', name: string, inLibrary: boolean) => {
    let item = changed.get(id);
    if (item) return item;
    const existing = byId.get(id);
    if (existing) {
      originals.push(existing);
      item = { ...existing, state: { ...emptyState(), ...(existing.state || {}) } };
    } else {
      created.push({ id, type, name });
      item = newLibraryItem(id, type, name, now, inLibrary);
    }
    item._mtime = now;
    changed.set(id, item);
    return item;
  };

  if (opts.watchlist) {
    for (const w of trakt.watchlist) {
      const existing = changed.get(w.id) || byId.get(w.id);
      if (existing && existing.removed !== true) continue;
      const item = working(w.id, w.type, w.name, true);
      item.removed = false;
      item.temp = false;
      summary.addedToLibrary.push(w.name);
    }
  }

  if (opts.watched) {
    for (const [id, m] of Object.entries(trakt.movies)) {
      const existing = changed.get(id) || byId.get(id);
      const st = existing?.state || {};
      if (existing && (st.flaggedWatched === 1 || Number(st.timesWatched) > 0)) continue;
      const item = working(id, 'movie', m.name, false);
      item.state.flaggedWatched = 1;
      item.state.timesWatched = Math.max(Number(item.state.timesWatched) || 0, m.plays);
      item.state.lastWatched = maxIso(item.state.lastWatched, m.last);
      summary.moviesWatched.push(m.name);
    }

    for (const [id, sh] of Object.entries(trakt.shows)) {
      const meta = metas[id];
      if (!meta?.videos.length) {
        summary.seriesWithoutEpisodes.push(sh.name);
        continue;
      }
      const videos = sortVideos(meta.videos);
      const ids = videos.map((v) => v.id);
      const existing = changed.get(id) || byId.get(id);
      const prev = existing?.state?.watched ? String(existing.state.watched) : null;
      // Stremio's own field must be readable against this episode list, otherwise rewriting it would lose episodes.
      if (prev && !ids.includes(parseWatchedField(prev)?.anchorVideo ?? '')) {
        summary.seriesWithoutEpisodes.push(sh.name);
        continue;
      }
      const current = prev ? decodeWatched(prev, ids) : ids.map(() => false);
      let added = 0;
      const flags = videos.map((v, i) => {
        if (current[i]) return true;
        const hit = sh.episodes.has(`${v.season}:${v.episode}`);
        if (hit) added++;
        return hit;
      });
      if (!added) continue;
      const item = working(id, 'series', sh.name, false);
      item.state.watched = encodeWatched(ids, flags);
      item.state.timesWatched = Math.max(Number(item.state.timesWatched) || 0, flags.filter(Boolean).length);
      item.state.lastWatched = maxIso(item.state.lastWatched, sh.last);
      summary.episodesWatched += added;
      summary.seriesUpdated.push(sh.name);
    }
  }

  const likes: ReversePlan['likes'] = [];
  if (opts.likes) {
    for (const [id, r] of Object.entries(trakt.ratings)) {
      const status = likeForRating(r.rating);
      if (!status || currentLikes[id]) continue; // never overwrite an existing like
      likes.push({ id, type: r.type, name: r.name, status });
    }
  }

  return { changes: [...changed.values()], originals, created, likes, summary };
}

/** Reads what is needed from Trakt for the reverse direction. */
export async function fetchTraktSide(client: TraktClient, opts: ReverseOptions, signal?: AbortSignal): Promise<TraktSide> {
  const side: TraktSide = { watchlist: [], movies: {}, shows: {}, ratings: {} };
  const name = (o: any) => o?.title || o?.ids?.imdb || '?';

  if (opts.watchlist) {
    for (const e of await client.getAll<any>('/sync/watchlist/movies', 100, signal)) {
      const id = e?.movie?.ids?.imdb;
      if (id) side.watchlist.push({ id, type: 'movie', name: name(e.movie) });
    }
    for (const e of await client.getAll<any>('/sync/watchlist/shows', 100, signal)) {
      const id = e?.show?.ids?.imdb;
      if (id) side.watchlist.push({ id, type: 'series', name: name(e.show) });
    }
  }
  if (opts.watched) {
    for (const e of await client.getAll<any>('/sync/history/movies', 100, signal)) {
      const id = e?.movie?.ids?.imdb;
      if (!id) continue;
      const m = (side.movies[id] ||= { name: name(e.movie), plays: 0, last: e.watched_at });
      m.plays++;
      m.last = maxIso(m.last, e.watched_at) || m.last;
    }
    for (const e of await client.getAll<any>('/sync/history/episodes', 100, signal)) {
      const id = e?.show?.ids?.imdb;
      const s = e?.episode?.season;
      const n = e?.episode?.number;
      if (!id || s === undefined || n === undefined) continue;
      const sh = (side.shows[id] ||= { name: name(e.show), episodes: new Set(), last: e.watched_at });
      sh.episodes.add(`${s}:${n}`);
      sh.last = maxIso(sh.last, e.watched_at) || sh.last;
    }
  }
  if (opts.likes) {
    for (const e of await client.getAll<any>('/sync/ratings/movies', 100, signal)) {
      const id = e?.movie?.ids?.imdb;
      if (id && e.rating) side.ratings[id] = { type: 'movie', name: name(e.movie), rating: e.rating };
    }
    for (const e of await client.getAll<any>('/sync/ratings/shows', 100, signal)) {
      const id = e?.show?.ids?.imdb;
      if (id && e.rating) side.ratings[id] = { type: 'series', name: name(e.show), rating: e.rating };
    }
  }
  return side;
}

/** Undo data for the last Trakt → Stremio write. */
export interface ReverseUndo {
  at: number;
  account: string;
  originals: any[];
  created: Created[];
  likes: { id: string; type: 'movie' | 'series' }[];
}

/** Items that restore the library to how it was before the write. */
export function undoChanges(undo: ReverseUndo, now = new Date().toISOString()): any[] {
  const restored = undo.originals.map((o) => ({ ...o, _mtime: now }));
  // Created items cannot be deleted from Stremio's datastore; they are hidden and reset.
  const hidden = undo.created.map((c) => ({ ...newLibraryItem(c.id, c.type, c.name, now, false), temp: false }));
  return [...restored, ...hidden];
}
