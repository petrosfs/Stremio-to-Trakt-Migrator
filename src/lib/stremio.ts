import { decodeWatched, sortVideos } from './bitfield';
import type { EpisodeDateMode, MigrationData, ParseResult, StremioItem } from '../types';

const API = 'https://api.strem.io/api';
const LINK_API = 'https://link.stremio.com/api/v2';
const CINEMETA = 'https://v3-cinemeta.strem.io';

export class StremioError extends Error {}

// ---------- Account ----------

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (json?.error) throw new StremioError(json.error.message || 'Stremio error');
  if (!res.ok || !json || !('result' in json)) throw new StremioError(`Stremio HTTP ${res.status}`);
  return json.result as T;
}

export async function login(email: string, password: string): Promise<{ authKey: string; email: string }> {
  const r = await call<{ authKey: string; user?: { email?: string } }>('login', {
    type: 'Login',
    email,
    password,
    facebook: false,
  });
  return { authKey: r.authKey, email: r.user?.email || email };
}

export async function logout(authKey: string): Promise<void> {
  try {
    await call('logout', { type: 'Logout', authKey });
  } catch {
    /* best effort */
  }
}

export interface LinkCode {
  code: string;
  link: string;
  qrcode: string;
}

/** Login without a password: the user opens the link while signed in to Stremio. */
export async function createLink(): Promise<LinkCode> {
  const res = await fetch(`${LINK_API}/create?type=Create`);
  const json = await res.json().catch(() => null);
  const r = json?.result;
  if (!r?.code) throw new StremioError('Link create failed');
  return { code: r.code, link: r.link, qrcode: r.qrcode };
}

/** Returns the authKey once the code has been confirmed, otherwise null. */
export async function readLink(code: string): Promise<string | null> {
  const res = await fetch(`${LINK_API}/read?type=Read&code=${encodeURIComponent(code)}`);
  const json = await res.json().catch(() => null);
  return json?.result?.authKey || null;
}

export async function getUserEmail(authKey: string): Promise<string | undefined> {
  try {
    const u = await call<{ email?: string }>('getUser', { type: 'GetUser', authKey });
    return u?.email;
  } catch {
    return undefined;
  }
}

export async function getLibrary(authKey: string): Promise<any[]> {
  return call<any[]>('datastoreGet', { authKey, collection: 'libraryItem', ids: [], all: true });
}

/** Writes library items (full LibraryItem objects), in chunks. */
export async function putLibrary(authKey: string, changes: any[], onProgress?: (done: number) => void, chunk = 100): Promise<void> {
  for (let i = 0; i < changes.length; i += chunk) {
    const part = changes.slice(i, i + chunk);
    await call('datastorePut', { authKey, collection: 'libraryItem', changes: part });
    onProgress?.(Math.min(i + chunk, changes.length));
  }
}

// ---------- Metadata ----------

export interface SeriesMeta {
  name?: string;
  poster?: string;
  videos: { id: string; season?: number; episode?: number; released?: string; name?: string }[];
}

export async function fetchSeriesMeta(imdbId: string): Promise<SeriesMeta | null> {
  try {
    const res = await fetch(`${CINEMETA}/meta/series/${imdbId}.json`);
    if (!res.ok) return null;
    const m = (await res.json())?.meta;
    if (!m) return null;
    return {
      name: m.name,
      poster: m.poster,
      videos: (Array.isArray(m.videos) ? m.videos : []).map((v: any) => ({
        id: String(v.id),
        season: typeof v.season === 'number' ? v.season : undefined,
        episode: typeof v.episode === 'number' ? v.episode : typeof v.number === 'number' ? v.number : undefined,
        released: v.released || v.firstAired,
        name: v.name || v.title,
      })),
    };
  } catch {
    return null;
  }
}

export async function fetchMetas(
  ids: string[],
  onProgress?: (done: number) => void,
  concurrency = 6,
): Promise<Record<string, SeriesMeta>> {
  const out: Record<string, SeriesMeta> = {};
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const m = await fetchSeriesMeta(id);
      if (m) out[id] = m;
      onProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}

const LIKES_API = 'https://likes.stremio.com/api';

/** Reads the Stremio like status (loved / liked) of each item. */
export async function fetchLikes(
  authKey: string,
  items: { id: string; type: 'movie' | 'series' }[],
  onProgress?: (done: number) => void,
  concurrency = 8,
): Promise<Record<string, LikeStatus>> {
  const out: Record<string, LikeStatus> = {};
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      try {
        const res = await fetch(
          `${LIKES_API}/get_status?authToken=${encodeURIComponent(authKey)}&mediaId=${encodeURIComponent(it.id)}&mediaType=${it.type}`,
        );
        const status = res.ok ? (await res.json())?.status : null;
        if (status === 'loved' || status === 'liked') out[it.id] = status;
      } catch {
        /* ignore: treated as no like */
      }
      onProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

/** Sets the Stremio like status of an item (null clears it). Used for Trakt → Stremio. */
export async function sendLike(authKey: string, id: string, type: 'movie' | 'series', status: LikeStatus | null): Promise<boolean> {
  try {
    const res = await fetch(`${LIKES_API}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken: authKey, mediaId: id, mediaType: type, status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Release dates of movies from Cinemeta. */
export async function fetchMovieReleases(ids: string[], concurrency = 6): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const res = await fetch(`${CINEMETA}/meta/movie/${id}.json`);
        const m = res.ok ? (await res.json())?.meta : null;
        if (m?.released) out[id] = m.released;
      } catch {
        /* ignore */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}

/** Movies watched more than once (their earlier plays need a release date). */
export function moviesWithRepeats(items: any[]): string[] {
  return items
    .filter((x) => kindOf(x) === 'movie' && Number(x?.state?.timesWatched) > 1)
    .map((x) => imdbOf(x))
    .filter((id): id is string => !!id);
}

/** Library items that can carry a like (movies and series with IMDB ids). */
export function likeCandidates(items: any[]): { id: string; type: 'movie' | 'series' }[] {
  const out: { id: string; type: 'movie' | 'series' }[] = [];
  const seen = new Set<string>();
  for (const x of items) {
    const kind = kindOf(x);
    const id = imdbOf(x);
    if (!kind || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, type: kind === 'movie' ? 'movie' : 'series' });
  }
  return out;
}

// ---------- Classification ----------

export type LikeStatus = 'loved' | 'liked';
export const LIKE_RATING: Record<LikeStatus, number> = { loved: 9, liked: 7 };
/** Safety cap for repeat plays of one movie. */
const MAX_PLAYS = 20;

export interface ClassifyExtras {
  /** Stremio like status per IMDB id. */
  likes?: Record<string, LikeStatus>;
  /** Release date per movie IMDB id (for dating repeat plays). */
  movieReleases?: Record<string, string>;
}

export const posterFor = (imdbId: string) => `https://images.metahub.space/poster/small/${imdbId}/img`;

export function itemKey(id: string, type: StremioItem['type'], season?: number, episode?: number): string {
  return type === 'episode' ? `${id}:${season}:${episode}` : `${type}:${id}`;
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (value === '') return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) || d.getTime() <= 0 ? undefined : d.toISOString();
}

function imdbOf(x: any): string | null {
  const refs = [x?._id, x?.id, x?.imdb_id, x?.meta?.imdb_id, x?.meta?.id];
  const ref = refs.find((r) => typeof r === 'string' && r.startsWith('tt'));
  return ref ? (ref as string).split(':')[0] : null;
}

function kindOf(x: any): 'movie' | 'show' | null {
  const t = String(x?.type || x?.meta?.type || '').toLowerCase();
  if (t === 'movie') return 'movie';
  if (t === 'series' || t === 'show' || t === 'tv') return 'show';
  return null;
}

/** Series ids whose metadata we need (episode lists for watched data or the current episode). */
export function seriesNeedingMeta(items: any[]): string[] {
  const ids = new Set<string>();
  for (const x of items) {
    if (kindOf(x) !== 'show') continue;
    const id = imdbOf(x);
    const st = x?.state || {};
    if (id && (st.watched || st.video_id)) ids.add(id);
  }
  return [...ids];
}

function parseEpisodeId(videoId: unknown): { season: number; episode: number } | null {
  if (typeof videoId !== 'string') return null;
  const p = videoId.split(':');
  if (p.length < 3) return null;
  const season = Number(p[p.length - 2]);
  const episode = Number(p[p.length - 1]);
  return Number.isInteger(season) && Number.isInteger(episode) ? { season, episode } : null;
}

/**
 * Classifies Stremio library items (as returned by datastoreGet or a JSON export).
 * Rules follow stremio-core: `removed` items are no longer in the library (but their
 * watch history is kept); `temp` items exist only for Continue Watching; an item is
 * in progress when `timeOffset > 0`.
 */
export function classify(
  items: any[],
  metas: Record<string, SeriesMeta>,
  episodeDate: EpisodeDateMode = 'released',
  extras: ClassifyExtras = {},
): ParseResult {
  const data: MigrationData = { collection: [], watchlist: [], history: [], continueWatching: [], rated: [] };
  const stats = { total: 0, withoutImdb: 0, removed: 0, seriesDecoded: 0, seriesFailed: 0 };
  const seen = new Set<string>();
  const push = (cat: keyof MigrationData, item: StremioItem) => {
    const k = `${cat}|${item.key}`;
    if (seen.has(k)) return;
    seen.add(k);
    data[cat].push(item);
  };

  for (const x of items) {
    const kind = kindOf(x);
    if (!kind) continue;
    stats.total++;
    const id = imdbOf(x);
    if (!id) {
      stats.withoutImdb++;
      continue;
    }
    const removed = x.removed === true;
    const temp = x.temp === true;
    if (removed && !temp) stats.removed++;
    const inLibrary = !removed;
    const st = x.state || {};
    const lastWatched = toIso(st.lastWatched);
    const inProgress = Number(st.timeOffset) > 0 && (!removed || temp);
    const dur = Number(st.duration);
    const pct = dur > 0 ? Math.min(100, Math.max(0, (Number(st.timeOffset) / dur) * 100)) : undefined;
    const prog = inProgress && pct !== undefined ? { progress: Math.round(pct * 10) / 10 } : {};
    const mtime = toIso(x._mtime);
    const changed = [mtime, lastWatched].filter(Boolean).sort().pop();
    const changedAt = changed ? { changedAt: changed } : {};
    const meta = kind === 'show' ? metas[id] : undefined;
    const name = x.name || meta?.name || 'Unknown';
    const poster = (typeof x.poster === 'string' && x.poster) || meta?.poster || posterFor(id);
    const base: StremioItem = { key: itemKey(id, kind), id, type: kind, name, poster, ...changedAt };

    // Stremio likes become Trakt ratings (loved = 9, liked = 7).
    const like = extras.likes?.[id];
    if (like === 'loved' || like === 'liked') push('rated', { ...base, rating: LIKE_RATING[like] });

    if (kind === 'movie') {
      const watched = st.flaggedWatched === 1 || st.flaggedWatched === true || Number(st.timesWatched) > 0;
      if (watched) {
        push('history', { ...base, ...(lastWatched ? { watchedAt: lastWatched } : {}) });
        // Stremio counts every full watch of a movie but keeps only the last date.
        // Earlier plays are dated at the movie's release (a minute apart so they stay distinct).
        // Without a release date there is nothing honest to date them with, so they are skipped.
        const times = Math.min(Number(st.timesWatched) || 0, MAX_PLAYS);
        const release = toIso(extras.movieReleases?.[id]);
        if (release) {
          for (let n = 2; n <= times; n++) {
            const at = new Date(Date.parse(release) + (n - 2) * 60_000).toISOString();
            push('history', { ...base, key: `${base.key}#${n}`, play: n, watchedAt: at });
          }
        }
      }
      else if (inProgress) push('continueWatching', { ...base, ...prog, ...(lastWatched ? { watchedAt: lastWatched } : {}) });
      else if (inLibrary) push('watchlist', base);
      if (inLibrary) push('collection', base);
      continue;
    }

    // ----- series -----
    let decoded = 0;
    if (st.watched) {
      if (meta && meta.videos.length) {
        const videos = sortVideos(meta.videos);
        const flags = decodeWatched(String(st.watched), videos.map((v) => v.id));
        const anchor = String(st.watched).split(':').slice(0, -2).join(':');
        videos.forEach((v, i) => {
          if (!flags[i]) return;
          const ep = v.season !== undefined && v.episode !== undefined ? { season: v.season, episode: v.episode } : parseEpisodeId(v.id);
          if (!ep) return;
          let watchedAt: string | undefined;
          if (v.id === anchor && lastWatched) watchedAt = lastWatched;
          else if (episodeDate === 'released') watchedAt = toIso(v.released) || lastWatched;
          else if (episodeDate === 'lastWatched') watchedAt = lastWatched;
          push('history', {
            key: itemKey(id, 'episode', ep.season, ep.episode),
            id,
            type: 'episode',
            name: `${name} S${ep.season}E${ep.episode}`,
            poster,
            season: ep.season,
            episode: ep.episode,
            ...changedAt,
            ...(watchedAt ? { watchedAt } : {}),
          });
          decoded++;
        });
        stats.seriesDecoded++;
      } else {
        stats.seriesFailed++;
      }
    }

    const flagged = st.flaggedWatched === 1 || st.flaggedWatched === true;
    if (flagged && decoded === 0) push('history', { ...base, ...(lastWatched ? { watchedAt: lastWatched } : {}) });

    let continuing = false;
    if (inProgress) {
      const ep = parseEpisodeId(st.video_id);
      if (ep) {
        push('continueWatching', {
          key: itemKey(id, 'episode', ep.season, ep.episode),
          id,
          type: 'episode',
          name: `${name} S${ep.season}E${ep.episode}`,
          poster,
          season: ep.season,
          episode: ep.episode,
          ...changedAt,
          ...prog,
          ...(lastWatched ? { watchedAt: lastWatched } : {}),
        });
      } else {
        push('continueWatching', { ...base, ...prog, ...(lastWatched ? { watchedAt: lastWatched } : {}) });
      }
      continuing = true;
    }

    if (inLibrary && !continuing && !flagged) push('watchlist', base);
    if (inLibrary) push('collection', base);
  }

  return { data, stats };
}
