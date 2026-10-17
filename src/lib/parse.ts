import { itemKey, posterFor } from './stremio';
import type { MigrationData, ParseResult, StremioItem } from '../types';

/** Extracts the library items array from the supported JSON shapes. */
export function libraryItemsFromJson(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.result)) return raw.result;
  for (const k of ['library', 'libraryItems', 'library_items']) {
    const v = raw?.[k];
    if (v) return Array.isArray(v) ? v : Object.values(v);
  }
  return [];
}

/**
 * Extra episodes from older export formats, keyed like "tt1234567 1 2"
 * in a `nif` object (next episode to watch).
 */
export function legacyNextEpisodes(raw: any, names: Record<string, string>): StremioItem[] {
  const nif = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.nif : null;
  if (!nif || typeof nif !== 'object') return [];
  const out: StremioItem[] = [];
  for (const k of Object.keys(nif)) {
    const [id, s, e] = k.split(' ');
    const season = Number(s);
    const episode = Number(e);
    if (!id?.startsWith('tt') || !Number.isInteger(season) || !Number.isInteger(episode)) continue;
    out.push({
      key: itemKey(id, 'episode', season, episode),
      id,
      type: 'episode',
      name: `${names[id] || id} S${season}E${episode}`,
      poster: posterFor(id),
      season,
      episode,
    });
  }
  return out;
}

/** Parses a saved Stremio Web library page (HTML). */
export function parseHtml(text: string): ParseResult {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/detail/"]'));
  const data: MigrationData = { collection: [], watchlist: [], history: [], continueWatching: [], rated: [] };
  const seen = new Set<string>();

  for (const link of links) {
    const match = (link.getAttribute('href') || '').match(/\/detail\/(movie|series)\/([^/]+)/);
    if (!match) continue;
    const id = decodeURIComponent(match[2]).split(':')[0];
    if (!id.startsWith('tt')) continue;
    const type: 'movie' | 'show' = match[1] === 'series' ? 'show' : 'movie';
    const key = itemKey(id, type);
    if (seen.has(key)) continue;
    seen.add(key);

    const name = link.getAttribute('title') || link.textContent?.trim() || 'Unknown';
    const item: StremioItem = { key, id, type, name, poster: posterFor(id) };
    data.collection.push(item);

    if (link.querySelector('[class*="watched-icon"]')) data.history.push(item);
    else if (link.querySelector('[class*="progress-bar-layer"]')) data.continueWatching.push(item);
    else data.watchlist.push(item);
  }

  return {
    data,
    stats: { total: data.collection.length, withoutImdb: 0, removed: 0, seriesDecoded: 0, seriesFailed: 0 },
  };
}
