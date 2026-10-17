import { describe, expect, it } from 'vitest';
import { applyExisting, buildBody, endpointFor, traktKey } from '../../src/lib/sync';
import type { StremioItem } from '../../src/types';

const m = (id: string, watchedAt?: string): StremioItem => ({ key: `movie:${id}`, id, type: 'movie', name: id, watchedAt });
const e = (id: string, s: number, ep: number, watchedAt?: string): StremioItem => ({ key: `${id}:${s}:${ep}`, id, type: 'episode', name: id, season: s, episode: ep, watchedAt });

describe('sync helpers', () => {
  it('endpoints', () => {
    expect(endpointFor('history')).toBe('/sync/history');
    expect(endpointFor('watchlist', true)).toBe('/sync/watchlist/remove');
    expect(endpointFor('42')).toBe('/users/me/lists/42/items');
    expect(endpointFor('42', true)).toBe('/users/me/lists/42/items/remove');
  });

  it('groups episodes by show and season; dates only for history', () => {
    const items = [m('tt1', '2024-01-01T00:00:00.000Z'), e('tt9', 1, 1, '2020-01-01T00:00:00.000Z'), e('tt9', 1, 2), e('tt9', 2, 1)];
    const body = buildBody(items, true);
    expect(body.movies).toEqual([{ ids: { imdb: 'tt1' }, watched_at: '2024-01-01T00:00:00.000Z' }]);
    expect(body.shows).toEqual([
      {
        ids: { imdb: 'tt9' },
        seasons: [
          { number: 1, episodes: [{ number: 1, watched_at: '2020-01-01T00:00:00.000Z' }, { number: 2 }] },
          { number: 2, episodes: [{ number: 1 }] },
        ],
      },
    ]);
    expect(buildBody(items, false).movies[0]).toEqual({ ids: { imdb: 'tt1' } });
  });

  it('sends ratings only for the ratings destination', () => {
    const rated: StremioItem = { key: 'movie:tt1', id: 'tt1', type: 'movie', name: 'x', rating: 9 };
    expect(buildBody([rated], false, true).movies).toEqual([{ ids: { imdb: 'tt1' }, rating: 9 }]);
    expect(buildBody([rated], false, false).movies).toEqual([{ ids: { imdb: 'tt1' } }]);
    expect(endpointFor('ratings')).toBe('/sync/ratings');
    expect(endpointFor('ratings', true)).toBe('/sync/ratings/remove');
  });

  it('maps Trakt entries to item keys', () => {
    expect(traktKey({ type: 'movie', movie: { ids: { imdb: 'tt1' } } })).toBe('movie:tt1');
    expect(traktKey({ type: 'show', show: { ids: { imdb: 'tt2' } } })).toBe('show:tt2');
    expect(traktKey({ episode: { season: 1, number: 3 }, show: { ids: { imdb: 'tt3' } } })).toBe('tt3:1:3');
    expect(traktKey({ type: 'movie', movie: { ids: { imdb: null } } })).toBeNull();
  });

  it('filters out existing items', () => {
    const items = [m('tt1'), m('tt2')];
    expect(applyExisting(items, undefined)).toEqual({ toSend: items, existing: null });
    expect(applyExisting(items, new Set(['movie:tt1']))).toEqual({ toSend: [items[1]], existing: 1 });
  });
});
