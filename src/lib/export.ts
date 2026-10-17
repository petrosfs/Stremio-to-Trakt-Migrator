import { strToU8, zipSync } from 'fflate';
import type { MigrationData, StremioItem } from '../types';

interface Row {
  imdb_id: string;
  type: string;
  watched_at?: string;
  watchlisted_at?: string;
  season?: number;
  episode?: number;
}

function rows(data: MigrationData): Row[] {
  const now = new Date().toISOString();
  const base = (x: StremioItem): Row => ({
    imdb_id: x.id,
    type: x.type,
    ...(x.type === 'episode' ? { season: x.season, episode: x.episode } : {}),
  });
  return [
    ...data.watchlist.map((x) => ({ ...base(x), watchlisted_at: now })),
    ...data.history.map((x) => ({ ...base(x), ...(x.watchedAt ? { watched_at: x.watchedAt } : {}) })),
    ...data.continueWatching.map((x) => ({ ...base(x), watchlisted_at: x.watchedAt || now })),
  ];
}

export function toCsv(data: MigrationData): string {
  const cols = ['imdb_id', 'type', 'watched_at', 'watchlisted_at', 'season', 'episode'] as const;
  const lines = rows(data).map((r) => cols.map((c) => r[c] ?? '').join(','));
  return [cols.join(','), ...lines].join('\n') + '\n';
}

export function toJson(data: MigrationData): string {
  return JSON.stringify(rows(data), null, 2);
}

export function toZip(data: MigrationData): Blob {
  const zipped = zipSync({
    'stremio_library.json': strToU8(toJson(data)),
    'stremio_library.csv': strToU8(toCsv(data)),
  });
  return new Blob([zipped], { type: 'application/zip' });
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const today = () => new Date().toISOString().split('T')[0];
