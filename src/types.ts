export type ItemType = 'movie' | 'show' | 'episode';

export interface StremioItem {
  /** Unique key (movie:tt…, show:tt…, tt…:season:episode). */
  key: string;
  /** IMDB id (for episodes: the series IMDB id). */
  id: string;
  type: ItemType;
  name: string;
  poster?: string;
  watchedAt?: string;
  /** Playback progress 0-100 for items in progress (from Stremio timeOffset/duration). */
  progress?: number;
  /** Trakt rating 1-10 (from Stremio likes: loved = 9, liked = 7). */
  rating?: number;
  /** For repeat plays of a movie: which play this is (2, 3, …). The first play has none. */
  play?: number;
  /** Last time the item changed in Stremio (library mtime or last watch), ISO. */
  changedAt?: string;
  season?: number;
  episode?: number;
}

export type Category = 'collection' | 'watchlist' | 'history' | 'continueWatching' | 'rated';
export const CATEGORIES: Category[] = ['collection', 'watchlist', 'history', 'continueWatching', 'rated'];

export type MigrationData = Record<Category, StremioItem[]>;

export interface ParseStats {
  /** Library items read. */
  total: number;
  /** Items skipped because they have no IMDB id (e.g. kitsu:…). */
  withoutImdb: number;
  /** Removed from the library (kept only for their watch history). */
  removed: number;
  /** Series whose watched episodes were decoded. */
  seriesDecoded: number;
  /** Series with watched data that could not be decoded (no episode list). */
  seriesFailed: number;
}

export interface ParseResult {
  data: MigrationData;
  stats: ParseStats;
}

/** 'skip' | 'watchlist' | 'history' | a Trakt custom list id */
export type Destination = string;

export interface TraktKeys {
  clientId: string;
  /** Optional: apps created on Trakt since Oct 2026 have no secret. */
  clientSecret?: string;
}

export interface TraktAuth {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

export interface TraktList {
  id: number;
  name: string;
}

export interface LogEntry {
  time: number;
  msg: string;
  kind: 'info' | 'ok' | 'err';
}

/** How to date watched episodes that have no own date in Stremio. */
export type EpisodeDateMode = 'released' | 'lastWatched' | 'none';
