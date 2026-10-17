import { describe, expect, it } from 'vitest';
import { classify, seriesNeedingMeta, type SeriesMeta } from '../../src/lib/stremio';
import { libraryItemsFromJson, legacyNextEpisodes } from '../../src/lib/parse';

const movie = (id: string, state: any = {}, extra: any = {}) => ({ _id: id, name: `Movie ${id}`, type: 'movie', state, ...extra });
const series = (id: string, state: any = {}, extra: any = {}) => ({ _id: id, name: `Show ${id}`, type: 'series', state, ...extra });

const meta: Record<string, SeriesMeta> = {
  tt2934286: {
    name: 'Show',
    videos: Array.from({ length: 9 }, (_, i) => ({
      id: `tt2934286:1:${i + 1}`,
      season: 1,
      episode: i + 1,
      released: `2020-01-0${i + 1}T00:00:00.000Z`,
    })),
  },
};

describe('classify', () => {
  it('puts watched movies in history, in-progress in continue watching, others in watchlist', () => {
    const r = classify(
      [
        movie('tt1', { flaggedWatched: 1, lastWatched: '2024-03-01T20:00:00.000Z' }),
        movie('tt2', { timesWatched: 2 }),
        movie('tt3', { timeOffset: 1200, lastWatched: '2024-05-01T00:00:00.000Z' }),
        movie('tt4'),
      ],
      {},
    );
    expect(r.data.history.map((i) => i.id)).toEqual(['tt1', 'tt2']);
    expect(r.data.history[0].watchedAt).toBe('2024-03-01T20:00:00.000Z');
    expect(r.data.continueWatching.map((i) => i.id)).toEqual(['tt3']);
    expect(r.data.watchlist.map((i) => i.id)).toEqual(['tt4']);
    expect(r.data.collection).toHaveLength(4);
  });

  it('keeps history of removed items but drops them from the library', () => {
    const r = classify([movie('tt1', { timesWatched: 1 }, { removed: true }), movie('tt2', {}, { removed: true })], {});
    expect(r.data.history.map((i) => i.id)).toEqual(['tt1']);
    expect(r.data.watchlist).toHaveLength(0);
    expect(r.data.collection).toHaveLength(0);
    expect(r.stats.removed).toBe(2);
  });

  it('temp items count only for continue watching', () => {
    const r = classify([movie('tt1', { timeOffset: 50 }, { removed: true, temp: true })], {});
    expect(r.data.continueWatching).toHaveLength(1);
    expect(r.data.collection).toHaveLength(0);
  });

  it('decodes watched episodes and dates them', () => {
    const r = classify(
      [series('tt2934286', { watched: 'tt2934286:1:5:5:eJyTZwAAAEAAIA==', lastWatched: '2024-06-10T19:00:00.000Z' })],
      meta,
      'released',
    );
    const eps = r.data.history.filter((i) => i.type === 'episode');
    expect(eps.map((e) => e.episode)).toEqual([1, 2, 3, 4, 5]);
    // anchor (last watched) uses lastWatched, the rest their air date
    expect(eps[4].watchedAt).toBe('2024-06-10T19:00:00.000Z');
    expect(eps[0].watchedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(r.data.watchlist.map((i) => i.key)).toEqual(['show:tt2934286']);
    expect(r.stats.seriesDecoded).toBe(1);
  });

  it('episode date modes', () => {
    const item = series('tt2934286', { watched: 'tt2934286:1:5:5:eJyTZwAAAEAAIA==', lastWatched: '2024-06-10T19:00:00.000Z' });
    expect(classify([item], meta, 'lastWatched').data.history[0].watchedAt).toBe('2024-06-10T19:00:00.000Z');
    expect(classify([item], meta, 'none').data.history[0].watchedAt).toBeUndefined();
  });

  it('reports series whose episode list is missing', () => {
    const r = classify([series('tt2934286', { watched: 'tt2934286:1:5:5:eJyTZwAAAEAAIA==' })], {});
    expect(r.stats.seriesFailed).toBe(1);
    expect(r.data.history).toHaveLength(0);
  });

  it('computes playback progress from timeOffset/duration', () => {
    const r = classify([movie('tt3', { timeOffset: 2500, duration: 10000 }), movie('tt4', { timeOffset: 5 })], {});
    expect(r.data.continueWatching.map((i) => i.progress)).toEqual([25, undefined]);
  });

  it('adds the current episode to continue watching', () => {
    const r = classify([series('tt2934286', { timeOffset: 300, video_id: 'tt2934286:1:6' })], meta);
    expect(r.data.continueWatching[0]).toMatchObject({ type: 'episode', season: 1, episode: 6 });
    expect(r.data.watchlist).toHaveLength(0);
  });

  it('skips non-IMDB and non-video items', () => {
    const r = classify([series('kitsu:123'), { _id: 'x', type: 'channel' }, movie('tt1')], {});
    expect(r.stats.withoutImdb).toBe(1);
    expect(r.stats.total).toBe(2);
    expect(r.data.collection).toHaveLength(1);
  });

  it('lists series needing metadata', () => {
    expect(seriesNeedingMeta([series('tt1', { watched: 'x' }), series('tt2'), series('tt3', { video_id: 'tt3:1:1' }), movie('tt4', { watched: 'x' })])).toEqual(['tt1', 'tt3']);
  });
});

describe('likes, repeat plays, change dates', () => {
  it('maps Stremio likes to Trakt ratings (loved 9, liked 7)', () => {
    const r = classify([movie('tt1'), series('tt2'), movie('tt3')], {}, 'released', { likes: { tt1: 'loved', tt2: 'liked' } });
    expect(r.data.rated.map((i) => [i.key, i.rating])).toEqual([['movie:tt1', 9], ['show:tt2', 7]]);
  });

  it('adds earlier plays of a movie watched several times at its release date', () => {
    const r = classify(
      [movie('tt1', { timesWatched: 3, flaggedWatched: 1, lastWatched: '2024-05-10T20:00:00.000Z' })],
      {},
      'released',
      { movieReleases: { tt1: '2010-07-16T00:00:00.000Z' } },
    );
    expect(r.data.history.map((i) => [i.key, i.play, i.watchedAt])).toEqual([
      ['movie:tt1', undefined, '2024-05-10T20:00:00.000Z'],
      ['movie:tt1#2', 2, '2010-07-16T00:00:00.000Z'],
      ['movie:tt1#3', 3, '2010-07-16T00:01:00.000Z'],
    ]);
  });

  it('records when each item last changed (mtime or last watch)', () => {
    const r = classify(
      [movie('tt1', { lastWatched: '2024-01-01T00:00:00.000Z' }, { _mtime: '2024-03-01T00:00:00.000Z' }), movie('tt2', {}, { _mtime: '2023-01-01T00:00:00.000Z' })],
      {},
    );
    expect(r.data.watchlist.map((i) => i.changedAt)).toEqual(['2024-03-01T00:00:00.000Z', '2023-01-01T00:00:00.000Z']);
  });
});

describe('file helpers', () => {
  it('reads library items from all supported shapes', () => {
    const items = [movie('tt1')];
    expect(libraryItemsFromJson(items)).toBe(items);
    expect(libraryItemsFromJson({ result: items })).toBe(items);
    expect(libraryItemsFromJson({ library: { a: items[0] } })).toEqual(items);
    expect(libraryItemsFromJson({})).toEqual([]);
  });

  it('reads legacy next-episode keys', () => {
    const eps = legacyNextEpisodes({ nif: { 'tt5 2 3': 1, bad: 1 } }, { tt5: 'Five' });
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ key: 'tt5:2:3', name: 'Five S2E3' });
  });
});
