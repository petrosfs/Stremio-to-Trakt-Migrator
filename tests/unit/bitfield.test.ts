import { describe, expect, it } from 'vitest';
import { decodeWatched, encodeWatched, parseWatchedField, sortVideos } from '../../src/lib/bitfield';

const ep = (n: number, s = 1, id = 'tt2934286') => `${id}:${s}:${n}`;

describe('watched bitfield (stremio-core test vectors)', () => {
  it('parses anchor and length (id contains colons)', () => {
    const f = parseWatchedField('tt7767422:3:8:24:eJz7//8/AAX9Av4=')!;
    expect(f.anchorVideo).toBe('tt7767422:3:8');
    expect(f.anchorLength).toBe(24);
    expect(Array.from(f.bytes)).toEqual([255, 255, 255]);
  });

  it('decodes episodes 1-5 watched out of 9', () => {
    const videos = Array.from({ length: 9 }, (_, i) => ep(i + 1));
    const flags = decodeWatched('tt2934286:1:5:5:eJyTZwAAAEAAIA==', videos);
    expect(flags).toEqual([true, true, true, true, true, false, false, false, false]);
  });

  it('re-aligns when episodes were added before the anchor', () => {
    // Same bitfield, but two specials (season 0) now come first in the list.
    const videos = [ep(1, 0), ep(2, 0), ...Array.from({ length: 9 }, (_, i) => ep(i + 1))];
    const flags = decodeWatched('tt2934286:1:5:5:eJyTZwAAAEAAIA==', videos);
    expect(flags.slice(0, 2)).toEqual([false, false]);
    expect(flags.slice(2, 7)).toEqual([true, true, true, true, true]);
    expect(flags.slice(7)).toEqual([false, false, false, false]);
  });

  it('returns nothing watched when the anchor is unknown', () => {
    expect(decodeWatched('tt9999999:1:1:1:eJyTZwAAAEAAIA==', [ep(1), ep(2)])).toEqual([false, false]);
  });

  it('handles invalid input', () => {
    expect(parseWatchedField('garbage')).toBeNull();
    expect(decodeWatched('a:b:c', [ep(1)])).toEqual([false]);
  });

  it('sorts like stremio-core: season, episode, release date', () => {
    const sorted = sortVideos([
      { id: 'c', season: 2, episode: 1 },
      { id: 'a', season: 1, episode: 2 },
      { id: 'x' },
      { id: 'b', season: 1, episode: 1 },
    ]);
    expect(sorted.map((v) => v.id)).toEqual(['x', 'b', 'a', 'c']);
  });
});

describe('encodeWatched', () => {
  const videos = Array.from({ length: 9 }, (_, i) => `tt2934286:1:${i + 1}`);
  it('matches stremio-core anchor/length and round-trips', () => {
    const flags = [true, true, true, true, true, false, false, false, false];
    const enc = encodeWatched(videos, flags)!;
    expect(enc.startsWith('tt2934286:1:5:5:')).toBe(true);
    expect(decodeWatched(enc, videos)).toEqual(flags);
    // Same bitfield bytes as Stremio's own test vector.
    expect(Array.from(parseWatchedField(enc)!.bytes)).toEqual(Array.from(parseWatchedField('tt2934286:1:5:5:eJyTZwAAAEAAIA==')!.bytes));
  });
  it('handles gaps and long lists', () => {
    const many = Array.from({ length: 30 }, (_, i) => `tt1:1:${i + 1}`);
    const flags = many.map((_, i) => i % 3 === 0);
    expect(decodeWatched(encodeWatched(many, flags)!, many)).toEqual(flags);
  });
  it('returns null when nothing is watched', () => {
    expect(encodeWatched(videos, videos.map(() => false))).toBeNull();
  });
});
