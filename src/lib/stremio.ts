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

// ---------- Classification ----------

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
): ParseResult {
  const data: MigrationData = { collection: [], watchlist: [], history: [], continueWatching: [] };
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
    const meta = kind === 'show' ? metas[id] : undefined;
    const name = x.name || meta?.name || 'Unknown';
    const poster = (typeof x.poster === 'string' && x.poster) || meta?.poster || posterFor(id);
    const base: StremioItem = { key: itemKey(id, kind), id, type: kind, name, poster };

    if (kind === 'movie') {
      const watched = st.flaggedWatched === 1 || st.flaggedWatched === true || Number(st.timesWatched) > 0;
      if (watched) push('history', { ...base, ...(lastWatched ? { watchedAt: lastWatched } : {}) });
      else if (inProgress) push('continueWatching', { ...base, ...(lastWatched ? { watchedAt: lastWatched } : {}) });
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
          ...(lastWatched ? { watchedAt: lastWatched } : {}),
        });
      } else {
        push('continueWatching', { ...base, ...(lastWatched ? { watchedAt: lastWatched } : {}) });
      }
      continuing = true;
    }

    if (inLibrary && !continuing && !flagged) push('watchlist', base);
    if (inLibrary) push('collection', base);
  }

  return { data, stats };
}
