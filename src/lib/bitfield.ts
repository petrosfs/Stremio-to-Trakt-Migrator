import { unzlibSync, zlibSync } from 'fflate';

/**
 * Stremio stores the watched episodes of a series in `state.watched` as
 * `{anchorVideoId}:{anchorLength}:{base64(zlib(bitfield))}`.
 * The anchor video id itself contains ':' (e.g. `tt0903747:1:5`).
 * Bit i (LSB first inside each byte) tells if video i is watched, where videos
 * are sorted by season, episode, then release date. The anchor lets the bitfield
 * be re-aligned when episodes are added/removed from the list later.
 */
export interface WatchedField {
  anchorVideo: string;
  anchorLength: number;
  bytes: Uint8Array;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseWatchedField(serialized: string): WatchedField | null {
  if (typeof serialized !== 'string') return null;
  const parts = serialized.split(':');
  if (parts.length < 3) return null;
  const buf = parts.pop()!;
  const anchorLength = Number(parts.pop());
  if (!Number.isInteger(anchorLength)) return null;
  try {
    return { anchorVideo: parts.join(':'), anchorLength, bytes: unzlibSync(base64ToBytes(buf)) };
  } catch {
    return null;
  }
}

const getBit = (bytes: Uint8Array, i: number) => i >= 0 && (i >> 3) < bytes.length && ((bytes[i >> 3] >> (i & 7)) & 1) === 1;

/** Returns, for each video id (already in Stremio order), whether it is watched. */
export function decodeWatched(serialized: string, videoIds: string[]): boolean[] {
  const field = parseWatchedField(serialized);
  if (!field) return videoIds.map(() => false);
  const anchorIdx = videoIds.indexOf(field.anchorVideo);
  // Anchor not found: Stremio treats the series as having nothing watched.
  if (anchorIdx === -1) return videoIds.map(() => false);
  const offset = field.anchorLength - anchorIdx - 1;
  return videoIds.map((_, i) => getBit(field.bytes, i + offset));
}

export interface VideoLike {
  id: string;
  season?: number;
  episode?: number;
  released?: string;
}

/** Same ordering as stremio-core (missing values sort first). */
export function sortVideos<T extends VideoLike>(videos: T[]): T[] {
  const n = (v: number | undefined) => (typeof v === 'number' && !isNaN(v) ? v : -Infinity);
  const r = (v: string | undefined) => {
    const t = v ? Date.parse(v) : NaN;
    return isNaN(t) ? -Infinity : t;
  };
  return [...videos].sort(
    (a, b) => n(a.season) - n(b.season) || n(a.episode) - n(b.episode) || r(a.released) - r(b.released) || 0,
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Inverse of decodeWatched: builds Stremio's `state.watched` string for videos
 * (in Stremio order) and their watched flags. Returns null when nothing is watched.
 * The anchor is the last watched video, as stremio-core does.
 */
export function encodeWatched(videoIds: string[], flags: boolean[]): string | null {
  const last = flags.lastIndexOf(true);
  if (last === -1) return null;
  const bytes = new Uint8Array(Math.ceil(videoIds.length / 8));
  flags.forEach((f, i) => {
    if (f) bytes[i >> 3] |= 1 << (i & 7);
  });
  return `${videoIds[last]}:${last + 1}:${bytesToBase64(zlibSync(bytes, { level: 6 }))}`;
}
