import { describe, expect, it } from 'vitest';
import { decodeWatched, encodeWatched } from '../../src/lib/bitfield';
import { likeForRating, planReverse, undoChanges, type TraktSide } from '../../src/lib/reverse';

const NOW = '2026-10-17T10:00:00.000Z';
const ALL = { watchlist: true, watched: true, likes: true };
const SHOW = 'tt2934286';
const vids = Array.from({ length: 4 }, (_, i) => ({ id: `${SHOW}:1:${i + 1}`, season: 1, episode: i + 1 }));
const metas = { [SHOW]: { name: 'Show', videos: vids } };
const ids = vids.map((v) => v.id);

const side = (over: Partial<TraktSide> = {}): TraktSide => ({ watchlist: [], movies: {}, shows: {}, ratings: {}, ...over });
const lib = (id: string, over: any = {}) => ({
  _id: id,
  name: id,
  type: 'movie',
  removed: false,
  temp: false,
  _mtime: '2025-01-01T00:00:00.000Z',
  state: { timesWatched: 0, flaggedWatched: 0, lastWatched: null, timeOffset: 0, duration: 0 },
  ...over,
});

describe('likeForRating', () => {
  it('maps 9-10 to loved, 7-8 to liked, rest to nothing', () => {
    expect([10, 9, 8, 7, 6, 1].map(likeForRating)).toEqual(['loved', 'loved', 'liked', 'liked', null, null]);
  });
});

describe('planReverse', () => {
  it('adds missing watchlist items and restores removed ones, keeps library items as they are', () => {
    const library = [lib('tt1'), lib('tt2', { removed: true, state: { timesWatched: 2, flaggedWatched: 1 } })];
    const p = planReverse(
      library,
      side({
        watchlist: [
          { id: 'tt1', type: 'movie', name: 'In library' },
          { id: 'tt2', type: 'movie', name: 'Removed' },
          { id: 'tt3', type: 'series', name: 'New' },
        ],
      }),
      {},
      {},
      ALL,
      NOW,
    );
    expect(p.summary.addedToLibrary).toEqual(['Removed', 'New']);
    const tt2 = p.changes.find((c) => c._id === 'tt2');
    expect(tt2).toMatchObject({ removed: false, temp: false, _mtime: NOW });
    expect(tt2.state.timesWatched).toBe(2); // state kept
    const tt3 = p.changes.find((c) => c._id === 'tt3');
    expect(tt3).toMatchObject({ type: 'series', name: 'New', removed: false, temp: false, _ctime: NOW });
    expect(p.originals.map((o) => o._id)).toEqual(['tt2']);
    expect(p.created).toEqual([{ id: 'tt3', type: 'series', name: 'New' }]);
  });

  it('marks movies as watched; new ones stay out of the library (removed + temp)', () => {
    const library = [lib('tt1'), lib('tt2', { state: { timesWatched: 1, flaggedWatched: 1 } })];
    const p = planReverse(
      library,
      side({
        movies: {
          tt1: { name: 'A', plays: 3, last: '2024-05-01T20:00:00.000Z' },
          tt2: { name: 'B', plays: 1, last: '2024-05-01T20:00:00.000Z' },
          tt9: { name: 'C', plays: 1, last: '2023-01-01T20:00:00.000Z' },
        },
      }),
      {},
      {},
      ALL,
      NOW,
    );
    expect(p.summary.moviesWatched).toEqual(['A', 'C']);
    const a = p.changes.find((c) => c._id === 'tt1');
    expect(a.state).toMatchObject({ flaggedWatched: 1, timesWatched: 3, lastWatched: '2024-05-01T20:00:00.000Z' });
    expect(a.removed).toBe(false);
    const c = p.changes.find((x) => x._id === 'tt9');
    expect(c).toMatchObject({ removed: true, temp: true });
    expect(c.state.timesWatched).toBe(1);
  });

  it('merges Trakt episodes into the existing watched field without losing any', () => {
    const existing = lib(SHOW, { type: 'series', state: { timesWatched: 1, watched: encodeWatched(ids, [true, false, false, false]) } });
    const p = planReverse(
      [existing],
      side({ shows: { [SHOW]: { name: 'Show', episodes: new Set(['1:3']), last: '2025-06-17T00:00:00.000Z' } } }),
      metas,
      {},
      ALL,
      NOW,
    );
    expect(p.summary.episodesWatched).toBe(1);
    const item = p.changes[0];
    expect(decodeWatched(item.state.watched, ids)).toEqual([true, false, true, false]);
    expect(item.state.timesWatched).toBe(2);
  });

  it('skips shows that need no change, have no episode list or an unreadable field', () => {
    const done = lib(SHOW, { type: 'series', state: { watched: encodeWatched(ids, [true, true, false, false]) } });
    const p = planReverse(
      [done, lib('tt777', { type: 'series', state: { watched: 'tt777:1:9:9:eJyTZwAAAEAAIA==' } })],
      side({
        shows: {
          [SHOW]: { name: 'Show', episodes: new Set(['1:1', '1:2']), last: NOW },
          tt555: { name: 'No meta', episodes: new Set(['1:1']), last: NOW },
          tt777: { name: 'Odd', episodes: new Set(['1:1']), last: NOW },
        },
      }),
      { ...metas, tt777: { videos: [{ id: 'tt777:1:1', season: 1, episode: 1 }] } },
      {},
      ALL,
      NOW,
    );
    expect(p.changes).toEqual([]);
    expect(p.summary.seriesWithoutEpisodes).toEqual(['No meta', 'Odd']);
  });

  it('adds likes only where Stremio has none', () => {
    const p = planReverse(
      [],
      side({
        ratings: {
          tt1: { type: 'movie', name: 'A', rating: 10 },
          tt2: { type: 'series', name: 'B', rating: 7 },
          tt3: { type: 'movie', name: 'C', rating: 5 },
          tt4: { type: 'movie', name: 'D', rating: 9 },
        },
      }),
      {},
      { tt4: 'liked' },
      ALL,
      NOW,
    );
    expect(p.likes).toEqual([
      { id: 'tt1', type: 'movie', name: 'A', status: 'loved' },
      { id: 'tt2', type: 'series', name: 'B', status: 'liked' },
    ]);
  });

  it('respects the options', () => {
    const p = planReverse(
      [],
      side({ watchlist: [{ id: 'tt1', type: 'movie', name: 'A' }], ratings: { tt1: { type: 'movie', name: 'A', rating: 10 } } }),
      {},
      {},
      { watchlist: false, watched: true, likes: false },
      NOW,
    );
    expect(p.changes).toEqual([]);
    expect(p.likes).toEqual([]);
  });
});

describe('undoChanges', () => {
  it('restores originals and hides created items', () => {
    const orig = lib('tt2', { removed: true });
    const out = undoChanges(
      { at: 0, account: 'a', originals: [orig], created: [{ id: 'tt3', type: 'series', name: 'New' }], likes: [] },
      NOW,
    );
    expect(out[0]).toEqual({ ...orig, _mtime: NOW });
    expect(out[1]).toMatchObject({ _id: 'tt3', type: 'series', removed: true, temp: false });
    expect(out[1].state.timesWatched).toBe(0);
  });
});
