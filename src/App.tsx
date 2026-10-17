import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { AlertCircle, BookMarked, ChevronRight, History, KeyRound, Languages, LayoutList, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useTheme } from './theme';
import { useI18n } from './i18n';
import logo from './assets/logo.svg';
import {
  CATEGORIES,
  type Category,
  type Destination,
  type EpisodeDateMode,
  type LogEntry,
  type MigrationData,
  type ParseResult,
  type StremioItem,
  type TraktAuth,
  type TraktKeys,
  type TraktList,
} from './types';
import { libraryItemsFromJson, legacyNextEpisodes, parseHtml } from './lib/parse';
import * as stremio from './lib/stremio';
import { DeviceCode, TraktClient, TraktError, pollDeviceToken, requestDeviceCode, revokeToken, sleep } from './lib/trakt';
import { applyExisting, existingKeys, sendItems, type PlanStep, type SyncResult } from './lib/sync';
import { download, toCsv, toZip, today } from './lib/export';
import { load, save } from './lib/storage';
import SettingsModal from './components/SettingsModal';
import AuthModal from './components/AuthModal';
import LinkModal from './components/LinkModal';
import Sidebar from './components/Sidebar';
import SourceCard, { type SourceTab } from './components/SourceCard';
import TransferCard, { type Prefs, type Step } from './components/TransferCard';
import ItemsPanel, { type TypeFilter } from './components/ItemsPanel';
import ReverseCard from './components/ReverseCard';
import { fetchTraktSide, planReverse, undoChanges, type ReverseOptions, type ReversePlan, type ReverseUndo } from './lib/reverse';

const DEFAULT_PREFS: Prefs = { library: 'skip', watchlist: 'watchlist', continue: 'watchlist', history: 'history', rated: 'ratings' };

type Source =
  | { kind: 'items'; items: any[]; raw?: any }
  | { kind: 'html'; result: ParseResult };

interface LastRun {
  at: number;
  user: string;
  steps: { dest: Destination; items: StremioItem[] }[];
}

const errText = (t: (k: string, v?: any) => string, e: unknown) => {
  if (e instanceof stremio.StremioError) return t('err.stremio', { msg: e.message });
  if (e instanceof Error && e.message.startsWith('err.')) return t(e.message);
  if (e instanceof TypeError) return t('err.network');
  return e instanceof Error ? e.message : String(e);
};

export default function App() {
  const { t, lang, setLang } = useI18n();
  const { theme, cycle: cycleTheme } = useTheme();
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  // ---------- Log ----------
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const addLog = useCallback((msg: string, kind: LogEntry['kind'] = 'info') => {
    setLogs((prev) => [{ time: Date.now(), msg, kind }, ...prev].slice(0, 200));
  }, []);

  // ---------- Trakt ----------
  const [keys, setKeys] = useState<TraktKeys | null>(() => load<TraktKeys>('trakt_keys'));
  const [auth, setAuthState] = useState<TraktAuth | null>(() => load<TraktAuth>('trakt_auth'));
  const [username, setUsername] = useState<string | null>(null);
  const [lists, setLists] = useState<TraktList[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const pollAbort = useRef<AbortController | null>(null);

  const setAuth = useCallback((a: TraktAuth | null) => {
    setAuthState(a);
    save('trakt_auth', a);
    if (!a) {
      setUsername(null);
      setLists([]);
    }
  }, []);

  const client = useMemo(() => (keys && auth ? new TraktClient(keys, auth, setAuth) : null), [keys, auth, setAuth]);

  const verifiedUser = useRef<string | null>(null);
  useEffect(() => {
    if (!client) {
      verifiedUser.current = null;
      return;
    }
    let cancelled = false;
    setVerifying(true);
    (async () => {
      try {
        const me = await client.me();
        if (cancelled) return;
        setUsername(me.username);
        if (verifiedUser.current !== me.username) {
          addLog(t('msg.traktAs', { user: me.username }), 'ok');
          setExisting({});
        }
        verifiedUser.current = me.username;
        const l = await client.lists().catch(() => [] as TraktList[]);
        if (!cancelled) setLists(l);
      } catch (e) {
        if (!cancelled) addLog(errText(t, e), 'err');
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => {
      cancelled = true;
      setVerifying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, addLog]);

  const startTraktAuth = async () => {
    if (!keys) return setShowSettings(true);
    try {
      const code = await requestDeviceCode(keys.clientId);
      setDevice(code);
      addLog(t('msg.code', { code: code.userCode }));
      const ctrl = new AbortController();
      pollAbort.current = ctrl;
      setAuth(await pollDeviceToken(keys, code, ctrl.signal));
      addLog(t('msg.traktOk'), 'ok');
    } catch (e) {
      if (e instanceof TraktError && e.message === 'aborted') addLog(t('msg.authCancelled'));
      else addLog(errText(t, e), 'err');
    } finally {
      setDevice(null);
      pollAbort.current = null;
    }
  };

  const traktLogout = async () => {
    if (keys && auth) await revokeToken(keys, auth);
    setAuth(null);
    setExisting({});
    addLog(t('msg.traktLogout'));
  };

  const saveKeys = (k: TraktKeys) => {
    const changed = !keys || keys.clientId !== k.clientId || keys.clientSecret !== k.clientSecret;
    setKeys(k);
    save('trakt_keys', k);
    setShowSettings(false);
    if (changed && auth) setAuth(null);
    addLog(t('msg.keysSaved'), 'ok');
  };

  // ---------- Stremio / source ----------
  const [stremioAuth, setStremioAuth] = useState<{ authKey: string; email: string } | null>(() => load('stremio_auth'));
  const [sourceTab, setSourceTab] = useState<SourceTab>(() => (load<SourceTab>('source_tab') === 'file' ? 'file' : 'account'));
  const [source, setSource] = useState<Source | null>(null);
  const [metas, setMetas] = useState<Record<string, stremio.SeriesMeta>>({});
  const [extras, setExtras] = useState<stremio.ClassifyExtras>({});
  const [episodeDate, setEpisodeDate] = useState<EpisodeDateMode>(() => load<EpisodeDateMode>('episode_date') || 'released');
  const [loadingLib, setLoadingLib] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [link, setLink] = useState<stremio.LinkCode | null>(null);
  const linkAbort = useRef<AbortController | null>(null);

  useEffect(() => save('source_tab', sourceTab), [sourceTab]);
  useEffect(() => save('episode_date', episodeDate), [episodeDate]);

  // ---------- Selection & edits ----------
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({});

  const parsed = useMemo<ParseResult | null>(() => {
    if (!source) return null;
    if (source.kind === 'html') return source.result;
    const r = stremio.classify(source.items, metas, episodeDate, extras);
    if (source.raw) {
      const names: Record<string, string> = {};
      for (const it of r.data.collection) names[it.id] = it.name;
      const keys = new Set(r.data.continueWatching.map((i) => i.key));
      for (const ep of legacyNextEpisodes(source.raw, names)) if (!keys.has(ep.key)) r.data.continueWatching.push(ep);
    }
    return r;
  }, [source, metas, episodeDate, extras]);

  const data = useMemo<MigrationData | null>(() => {
    if (!parsed) return null;
    if (!Object.keys(dateOverrides).length) return parsed.data;
    const fix = (arr: StremioItem[]) => arr.map((it) => (dateOverrides[it.key] ? { ...it, watchedAt: dateOverrides[it.key] } : it));
    const out = {} as MigrationData;
    for (const c of CATEGORIES) out[c] = fix(parsed.data[c]);
    return out;
  }, [parsed, dateOverrides]);

  const isSelected = useCallback((cat: Category, key: string) => !excluded.has(`${cat}|${key}`), [excluded]);
  const selectItems = (cat: Category, itemKeys: string[], selected: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const k of itemKeys) {
        if (selected) next.delete(`${cat}|${k}`);
        else next.add(`${cat}|${k}`);
      }
      return next;
    });
  };
  const selectedData = useMemo<MigrationData | null>(() => {
    if (!data) return null;
    const out = {} as MigrationData;
    for (const c of CATEGORIES) out[c] = data[c].filter((it) => isSelected(c, it.key));
    return out;
  }, [data, isSelected]);

  const resetForNewSource = () => {
    setExcluded(new Set());
    setDateOverrides({});
    setResults([]);
    setProgress(0);
    setCurrentAction('');
    setStep('ready');
  };

  const logParsed = (r: ParseResult) => {
    addLog(
      t('msg.parsed', { movies: r.data.collection.length, history: r.data.history.length, cw: r.data.continueWatching.length }),
      r.data.collection.length || r.data.history.length ? 'ok' : 'err',
    );
    if (r.stats.withoutImdb) addLog(t('msg.withoutImdb', { n: r.stats.withoutImdb }));
    if (r.stats.removed) addLog(t('msg.removed', { n: r.stats.removed }));
    if (r.stats.seriesFailed) addLog(t('msg.seriesFailed', { n: r.stats.seriesFailed }), 'err');
  };

  const loadItems = async (items: any[], raw?: any, authKey?: string) => {
    const ids = stremio.seriesNeedingMeta(items);
    let m: Record<string, stremio.SeriesMeta> = {};
    if (ids.length) {
      addLog(t('msg.metas', { n: ids.length }));
      m = await stremio.fetchMetas(ids, (done) => setCurrentAction(`Cinemeta ${done}/${ids.length}`));
      addLog(t('msg.metasDone', { ok: Object.keys(m).length, n: ids.length }), Object.keys(m).length === ids.length ? 'ok' : 'err');
    }
    const ex: stremio.ClassifyExtras = {};
    const repeats = stremio.moviesWithRepeats(items);
    if (repeats.length) ex.movieReleases = await stremio.fetchMovieReleases(repeats);
    if (authKey) {
      const cands = stremio.likeCandidates(items);
      addLog(t('msg.likes', { n: cands.length }));
      ex.likes = await stremio.fetchLikes(authKey, cands, (done) => setCurrentAction(`Likes ${done}/${cands.length}`));
      addLog(t('msg.likesDone', { n: Object.keys(ex.likes).length }), 'ok');
    }
    setMetas(m);
    setExtras(ex);
    setSource({ kind: 'items', items, raw });
    resetForNewSource();
    logParsed(stremio.classify(items, m, episodeDate, ex));
  };

  const loadStremioLibrary = async (authKey: string) => {
    setLoadingLib(true);
    try {
      addLog(t('msg.libLoading'));
      const items = await stremio.getLibrary(authKey);
      addLog(t('msg.libLoaded', { n: items.length }), 'ok');
      setFileName(null);
      await loadItems(items, undefined, authKey);
    } catch (e) {
      addLog(errText(t, e), 'err');
      if (e instanceof stremio.StremioError && /session/i.test(e.message)) {
        setStremioAuth(null);
        save('stremio_auth', null);
      }
    } finally {
      setLoadingLib(false);
      setCurrentAction('');
    }
  };

  const stremioLogin = async (email: string, password: string) => {
    setLoadingLib(true);
    try {
      const a = await stremio.login(email, password);
      setStremioAuth(a);
      save('stremio_auth', a);
      addLog(t('msg.stremioOk', { user: a.email }), 'ok');
      await loadStremioLibrary(a.authKey);
    } catch (e) {
      addLog(errText(t, e), 'err');
      setLoadingLib(false);
    }
  };

  const stremioLink = async () => {
    try {
      const l = await stremio.createLink();
      setLink(l);
      const ctrl = new AbortController();
      linkAbort.current = ctrl;
      const deadline = Date.now() + 5 * 60_000;
      while (!ctrl.signal.aborted) {
        await sleep(3000);
        if (ctrl.signal.aborted) break;
        if (Date.now() > deadline) throw new Error('err.linkExpired');
        const key = await stremio.readLink(l.code).catch(() => null);
        if (key) {
          setLink(null);
          const user = await stremio.getUserEmail(key);
          const a = { authKey: key, email: user || 'Stremio' };
          setStremioAuth(a);
          save('stremio_auth', a);
          addLog(t('msg.stremioOk', { user: a.email }), 'ok');
          await loadStremioLibrary(key);
          return;
        }
      }
      addLog(t('msg.authCancelled'));
    } catch (e) {
      addLog(errText(t, e), 'err');
    } finally {
      setLink(null);
      linkAbort.current = null;
    }
  };

  const stremioLogout = async () => {
    if (stremioAuth) await stremio.logout(stremioAuth.authKey);
    setStremioAuth(null);
    save('stremio_auth', null);
    addLog(t('msg.stremioLogout'));
  };

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result || '');
      const head = text.trimStart();
      const isJson = file.name.toLowerCase().endsWith('.json') || head.startsWith('{') || head.startsWith('[');
      try {
        setFileName(file.name);
        if (isJson) {
          const raw = JSON.parse(text);
          setLoadingLib(true);
          await loadItems(libraryItemsFromJson(raw), raw);
        } else {
          const r = parseHtml(text);
          setMetas({});
          setSource({ kind: 'html', result: r });
          resetForNewSource();
          logParsed(r);
        }
      } catch (e) {
        console.error(e);
        addLog(t('msg.parseError'), 'err');
      } finally {
        setLoadingLib(false);
        setCurrentAction('');
      }
    };
    reader.onerror = () => addLog(t('msg.readError'), 'err');
    reader.readAsText(file);
  };

  // ---------- Plan ----------
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...(load<Prefs>('sync_prefs') || {}) }));
  const [skipExisting, setSkipExisting] = useState<boolean>(() => load<boolean>('skip_existing') ?? true);
  const [existing, setExisting] = useState<Record<string, Set<string>>>({});
  const [checking, setChecking] = useState(false);
  useEffect(() => save('sync_prefs', prefs), [prefs]);
  useEffect(() => save('skip_existing', skipExisting), [skipExisting]);

  // Incremental transfers: remember when the last complete transfer ran for this account pair.
  const syncKey = `last_sync:${stremioAuth?.email || 'file'}:${username || ''}`;
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useState<boolean>(() => load<boolean>('only_new') ?? false);
  useEffect(() => setLastSyncAt(username ? load<string>(syncKey) : null), [syncKey, username]);
  useEffect(() => save('only_new', onlyNew), [onlyNew]);
  const sinceFilter = onlyNew && lastSyncAt ? lastSyncAt : null;

  const destName = useCallback(
    (d: Destination) =>
      d === 'watchlist' ? 'Watchlist' : d === 'history' ? 'History' : d === 'playback' ? t('transfer.playback') : d === 'ratings' ? t('transfer.ratings') : lists.find((l) => String(l.id) === d)?.name || t('msg.listN', { id: d }),
    [lists, t],
  );

  const buildPlan = useCallback(
    (sets: Record<string, Set<string>>): PlanStep[] => {
      if (!selectedData) return [];
      const steps: { cat: Category; dest: Destination }[] = [
        { cat: 'collection', dest: prefs.library },
        { cat: 'watchlist', dest: prefs.watchlist },
        { cat: 'continueWatching', dest: prefs.continue },
        { cat: 'history', dest: prefs.history },
        { cat: 'rated', dest: prefs.rated },
      ];
      return steps
        .filter((s) => s.dest !== 'skip' && selectedData[s.cat].length > 0)
        .map((s) => {
          const all = selectedData[s.cat];
          // Items without a change date (e.g. from an HTML page) are always kept.
          const items = sinceFilter ? all.filter((it) => !it.changedAt || it.changedAt > sinceFilter) : all;
          const { toSend, existing: ex } = applyExisting(items, skipExisting ? sets[s.dest] : undefined);
          return { cat: s.cat, label: t(`cat.${s.cat}`), dest: s.dest, items, toSend, existing: skipExisting ? ex : null };
        })
        .filter((s) => s.items.length > 0);
    },
    [selectedData, prefs, skipExisting, sinceFilter, t],
  );
  const plan = useMemo(() => buildPlan(existing), [buildPlan, existing]);

  const checkDests = async (dests: Destination[], signal?: AbortSignal) => {
    if (!client) return existing;
    const sets = { ...existing };
    for (const d of dests) {
      addLog(t('msg.checking', { dest: destName(d) }));
      sets[d] = await existingKeys(client, d, signal);
      addLog(t('msg.checked', { dest: destName(d), n: sets[d].size }));
    }
    setExisting(sets);
    return sets;
  };

  const onCheck = async () => {
    setChecking(true);
    try {
      await checkDests([...new Set(plan.map((s) => s.dest))]);
    } catch (e) {
      addLog(errText(t, e), 'err');
    } finally {
      setChecking(false);
    }
  };

  // ---------- Sync ----------
  const [step, setStep] = useState<Step>('idle');
  const [progress, setProgress] = useState(0);
  const [currentAction, setCurrentAction] = useState('');
  const [results, setResults] = useState<{ cat: Category; dest: Destination; result: SyncResult }[]>([]);
  const [lastRun, setLastRun] = useState<LastRun | null>(() => load<LastRun>('last_run'));
  const [undoing, setUndoing] = useState(false);
  const syncAbort = useRef<AbortController | null>(null);

  const startSync = async () => {
    if (!client || !plan.length) return;
    const ctrl = new AbortController();
    syncAbort.current = ctrl;
    const syncStartedAt = new Date().toISOString();
    setStep('syncing');
    setShowPanel(false);
    setProgress(0);
    setResults([]);
    const out: { cat: Category; dest: Destination; result: SyncResult }[] = [];
    const runSteps: LastRun['steps'] = [];

    try {
      let sets = existing;
      if (skipExisting) {
        const missing = [...new Set(plan.map((s) => s.dest))].filter((d) => !existing[d]);
        if (missing.length) {
          setCurrentAction(t('transfer.checking'));
          sets = await checkDests(missing, ctrl.signal);
        }
      }
      const steps = buildPlan(sets);
      const total = steps.reduce((n, s) => n + s.toSend.length, 0) || 1;
      let done = 0;
      const nextSets = { ...sets };

      for (const s of steps) {
        if (ctrl.signal.aborted) break;
        if (!s.toSend.length) continue;
        addLog(t('msg.stepStart', { label: s.label, dest: destName(s.dest), n: s.toSend.length }));
        let catDone = 0;
        setCurrentAction(`${s.label}: 0/${s.toSend.length}`);
        const r = await sendItems(client, s.dest, s.toSend, {
          signal: ctrl.signal,
          onProgress: (n) => {
            done += n;
            catDone += n;
            setProgress(Math.round((done / total) * 100));
            setCurrentAction(`${s.label}: ${catDone}/${s.toSend.length}`);
          },
        });
        out.push({ cat: s.cat, dest: s.dest, result: r });
        setResults([...out]);
        if (r.sent.length) {
          runSteps.push({ dest: s.dest, items: r.sent.map(({ poster: _p, ...rest }) => rest) });
          const set = new Set(nextSets[s.dest] || []);
          for (const it of r.sent) set.add(it.key);
          nextSets[s.dest] = set;
        }
        addLog(
          t('msg.stepDone', { label: s.label, added: r.added, existing: r.existing, nf: r.notFound.length }) +
            (r.failedBatches ? t('panel.failed', { n: r.failedBatches }) : ''),
          r.failedBatches ? 'err' : 'ok',
        );
        if (r.notFound.length) {
          addLog(t('msg.notFound', { list: r.notFound.slice(0, 30).join(', ') + (r.notFound.length > 30 ? '…' : '') }), 'err');
        }
      }
      if (sets !== existing || runSteps.length) setExisting(nextSets);
      if (runSteps.length) {
        const run: LastRun = { at: Date.now(), user: username || '', steps: runSteps };
        setLastRun(run);
        save('last_run', run);
      }
      if (ctrl.signal.aborted) {
        addLog(t('msg.stopped'), 'err');
        setStep('ready');
      } else {
        if (username) {
          save(syncKey, syncStartedAt);
          setLastSyncAt(syncStartedAt);
        }
        setProgress(100);
        setCurrentAction(t('transfer.done'));
        setStep('complete');
        addLog(t('msg.allDone'), 'ok');
      }
    } catch (e) {
      if (!(e instanceof TraktError && e.message === 'aborted')) addLog(errText(t, e), 'err');
      else addLog(t('msg.stopped'), 'err');
      setStep('ready');
    } finally {
      syncAbort.current = null;
    }
  };

  const undoLast = async () => {
    if (!client || !lastRun) return;
    setUndoing(true);
    let removed = 0;
    try {
      const nextSets = { ...existing };
      for (const s of [...lastRun.steps].reverse()) {
        const r = await sendItems(client, s.dest, s.items, { remove: true });
        removed += r.added;
        if (nextSets[s.dest]) {
          const set = new Set(nextSets[s.dest]);
          for (const it of s.items) set.delete(it.key);
          nextSets[s.dest] = set;
        }
      }
      setExisting(nextSets);
      setLastRun(null);
      save('last_run', null);
      addLog(t('msg.undoDone', { n: removed }), 'ok');
      setResults([]);
      setStep(data ? 'ready' : 'idle');
    } catch (e) {
      addLog(errText(t, e), 'err');
    } finally {
      setUndoing(false);
    }
  };

  // ---------- Trakt → Stremio ----------
  const [revOpts, setRevOpts] = useState<ReverseOptions>(() => ({ watchlist: true, watched: true, likes: true, ...(load<ReverseOptions>('reverse_opts') || {}) }));
  const [revPlan, setRevPlan] = useState<ReversePlan | null>(null);
  const [revChecking, setRevChecking] = useState(false);
  const [revApplying, setRevApplying] = useState(false);
  const [revUndoing, setRevUndoing] = useState(false);
  const [revStatus, setRevStatus] = useState('');
  const [revUndo, setRevUndo] = useState<ReverseUndo | null>(() => load<ReverseUndo>('reverse_undo'));
  useEffect(() => save('reverse_opts', revOpts), [revOpts]);
  useEffect(() => setRevPlan(null), [source, revOpts, username]);

  const accountItems = source?.kind === 'items' && !fileName && stremioAuth ? source.items : null;

  const onReverseCheck = async () => {
    if (!client || !stremioAuth || !accountItems) return;
    setRevChecking(true);
    setRevPlan(null);
    try {
      addLog(t('msg.reverseFetch'));
      setRevStatus('Trakt…');
      const side = await fetchTraktSide(client, revOpts);
      // Episode lists for shows that are not in the Stremio library yet.
      const missing = Object.keys(side.shows).filter((id) => !metas[id]);
      let allMetas = metas;
      if (missing.length) {
        const more = await stremio.fetchMetas(missing, (d) => setRevStatus(`Cinemeta ${d}/${missing.length}`));
        allMetas = { ...metas, ...more };
        setMetas(allMetas);
      }
      // Likes are only known for library items; read the rest before deciding.
      let likes = extras.likes || {};
      const known = new Set(stremio.likeCandidates(accountItems).map((c) => c.id));
      const unknown = Object.entries(side.ratings)
        .filter(([id]) => !known.has(id))
        .map(([id, r]) => ({ id, type: r.type }));
      if (revOpts.likes && unknown.length) {
        const more = await stremio.fetchLikes(stremioAuth.authKey, unknown, (d) => setRevStatus(`Likes ${d}/${unknown.length}`));
        likes = { ...likes, ...more };
      }
      const plan = planReverse(accountItems, side, allMetas, likes, revOpts);
      setRevPlan(plan);
      addLog(
        t('msg.reversePlan', {
          lib: plan.summary.addedToLibrary.length,
          movies: plan.summary.moviesWatched.length,
          eps: plan.summary.episodesWatched,
          likes: plan.likes.length,
        }),
        'ok',
      );
    } catch (e) {
      addLog(errText(t, e), 'err');
    } finally {
      setRevChecking(false);
      setRevStatus('');
    }
  };

  const onReverseApply = async () => {
    if (!stremioAuth || !accountItems || !revPlan) return;
    setRevApplying(true);
    try {
      // Backup first, so the library can always be restored by hand.
      download(new Blob([JSON.stringify(accountItems, null, 2)], { type: 'application/json' }), `stremio_library_backup_${today()}.json`);
      addLog(t('msg.rawSaved'), 'ok');
      const undo: ReverseUndo = { at: Date.now(), account: stremioAuth.email, originals: revPlan.originals, created: revPlan.created, likes: [] };
      if (revPlan.changes.length) {
        await stremio.putLibrary(stremioAuth.authKey, revPlan.changes, (d) => setRevStatus(`Stremio ${d}/${revPlan.changes.length}`));
      }
      let failed = 0;
      for (const [i, l] of revPlan.likes.entries()) {
        setRevStatus(`Likes ${i + 1}/${revPlan.likes.length}`);
        if (await stremio.sendLike(stremioAuth.authKey, l.id, l.type, l.status)) undo.likes.push({ id: l.id, type: l.type });
        else failed++;
      }
      setRevUndo(undo);
      save('reverse_undo', undo);
      addLog(t('msg.reverseDone', { n: revPlan.changes.length, likes: undo.likes.length }), 'ok');
      if (failed) addLog(t('msg.likesFailed', { n: failed }), 'err');
      setRevPlan(null);
      await loadStremioLibrary(stremioAuth.authKey);
    } catch (e) {
      addLog(errText(t, e), 'err');
    } finally {
      setRevApplying(false);
      setRevStatus('');
    }
  };

  const onReverseUndo = async () => {
    if (!stremioAuth || !revUndo) return;
    setRevUndoing(true);
    try {
      const items = undoChanges(revUndo);
      if (items.length) await stremio.putLibrary(stremioAuth.authKey, items);
      for (const l of revUndo.likes) await stremio.sendLike(stremioAuth.authKey, l.id, l.type, null);
      addLog(t('msg.reverseUndone', { n: items.length + revUndo.likes.length }), 'ok');
      setRevUndo(null);
      save('reverse_undo', null);
      await loadStremioLibrary(stremioAuth.authKey);
    } catch (e) {
      addLog(errText(t, e), 'err');
    } finally {
      setRevUndoing(false);
    }
  };

  const exportZip = () => {
    if (!selectedData) return;
    download(toZip(selectedData), `stremio_library_${today()}.zip`);
    addLog(t('msg.zip'), 'ok');
  };
  const exportCsv = () => {
    if (!selectedData) return;
    download(new Blob([toCsv(selectedData)], { type: 'text/csv;charset=utf-8' }), `stremio_library_${today()}.csv`);
    addLog(t('msg.csv'), 'ok');
  };

  // ---------- UI state ----------
  const [showPanel, setShowPanel] = useState(false);
  const [tab, setTab] = useState<Category>('watchlist');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const syncing = step === 'syncing';
  const busy = syncing || undoing || checking || revChecking || revApplying || revUndoing;
  const tabDest = { collection: prefs.library, watchlist: prefs.watchlist, continueWatching: prefs.continue, history: prefs.history, rated: prefs.rated }[tab];

  useEffect(() => {
    document.title = lang === 'el' ? 'Stremio σε Trakt' : 'Stremio to Trakt Migrator';
  }, [lang]);

  const statCard = (cat: Category, Icon: typeof History) => (
    <button
      key={cat}
      type="button"
      disabled={!data}
      data-testid={`stat-${cat}`}
      onClick={() => {
        setShowPanel(true);
        setTab(cat);
      }}
      className={`text-left bg-white p-4 sm:p-5 rounded-xl border transition-all ${data ? 'cursor-pointer hover:shadow-md hover:border-indigo-200 border-slate-200' : 'border-slate-200 shadow-sm opacity-50'} ${showPanel && tab === cat ? 'ring-2 ring-indigo-200' : ''}`}
    >
      <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">{t(`cat.${cat}`)}</p>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-bold text-slate-900">{data?.[cat].length || 0}</p>
        <Icon className="w-4 h-4 text-slate-300 mb-1" />
      </div>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row font-sans text-slate-900 selection:bg-indigo-100">
      <Sidebar
        logs={logs}
        traktUser={username}
        stremioUser={stremioAuth?.email || null}
        onTraktLogout={traktLogout}
        onStremioLogout={stremioLogout}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 sticky top-0 z-10 shrink-0 gap-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <img src={logo} alt="" width={28} height={28} className="lg:hidden w-7 h-7 shrink-0" />
            <span className="text-slate-400 hidden sm:inline">Stremio → Trakt</span>
            <span className="text-slate-400 hidden sm:inline">/</span>
            <span className="text-slate-900 font-medium truncate">{t('app.title')}</span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={cycleTheme}
              title={t(`theme.${theme}`)}
              aria-label={t(`theme.${theme}`)}
              data-testid="theme"
              data-theme={theme}
              className="p-2 rounded-md border border-slate-200 text-slate-500 hover:text-indigo-600"
            >
              <ThemeIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLang(lang === 'el' ? 'en' : 'el')}
              title={t('header.lang')}
              aria-label={t('header.lang')}
              data-testid="lang"
              className="p-2 rounded-md border border-slate-200 text-slate-500 hover:text-indigo-600 flex items-center gap-1 text-[10px] font-bold"
            >
              <Languages className="w-4 h-4" />
              {lang === 'el' ? 'EN' : 'EL'}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              title={t('header.keys')}
              aria-label={t('header.keys')}
              data-testid="keys"
              className={`p-2 rounded-md border transition-colors ${keys ? 'border-slate-200 text-slate-500 hover:text-indigo-600' : 'border-amber-300 bg-amber-50 text-amber-600'}`}
            >
              <KeyRound className="w-4 h-4" />
            </button>
            {verifying ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-medium animate-pulse">
                <Settings className="w-3 h-3 animate-spin" />
                <span className="hidden sm:inline">{t('header.verifying')}</span>
              </div>
            ) : !username ? (
              <button
                onClick={startTraktAuth}
                disabled={!!device}
                data-testid="trakt-connect"
                className="bg-indigo-600 text-white px-3 sm:px-4 py-2 rounded-md text-xs font-semibold hover:bg-indigo-700 shadow-sm flex items-center gap-2 disabled:bg-slate-300"
              >
                <LogOut className="w-3 h-3 rotate-180" />
                {t('header.connect')}
              </button>
            ) : null}
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-6 flex-1">
          {!keys && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 items-start">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-800">
                <p className="font-bold mb-1">{t('keysBanner.title')}</p>
                <p>
                  {t('keysBanner.text')}{' '}
                  <button onClick={() => setShowSettings(true)} className="font-bold underline">
                    {t('keysBanner.link')}
                  </button>
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {statCard('collection', LayoutList)}
            {statCard('watchlist', BookMarked)}
            {statCard('history', History)}
            {statCard('continueWatching', ChevronRight)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-6">
              <SourceCard
                tab={sourceTab}
                onTab={setSourceTab}
                stremioUser={stremioAuth?.email || null}
                busy={loadingLib}
                disabled={busy}
                onLogin={stremioLogin}
                onLink={stremioLink}
                onReload={() => stremioAuth && loadStremioLibrary(stremioAuth.authKey)}
                onLogout={stremioLogout}
                fileName={fileName}
                onFile={loadFile}
                episodeDate={episodeDate}
                onEpisodeDate={setEpisodeDate}
                showEpisodeDate={source?.kind === 'items' && (parsed?.stats.seriesDecoded || 0) > 0}
                onDownloadRaw={
                  source?.kind === 'items'
                    ? () => {
                        download(new Blob([JSON.stringify(source.items, null, 2)], { type: 'application/json' }), `stremio_library_raw_${today()}.json`);
                        addLog(t('msg.rawSaved'), 'ok');
                      }
                    : undefined
                }
              />

              {data && (
                <TransferCard
                  connected={!!username}
                  lists={lists}
                  prefs={prefs}
                  onPref={(f, v) => setPrefs((p) => ({ ...p, [f]: v }))}
                  skipExisting={skipExisting}
                  onSkipExisting={setSkipExisting}
                  lastSyncAt={lastSyncAt}
                  onlyNew={onlyNew}
                  onOnlyNew={setOnlyNew}
                  plan={plan}
                  destName={destName}
                  checking={checking}
                  onCheck={onCheck}
                  step={step}
                  onSync={startSync}
                  onStop={() => syncAbort.current?.abort()}
                  onAgain={() => setStep('ready')}
                  onZip={exportZip}
                  onCsv={exportCsv}
                  lastRun={lastRun && lastRun.user === username ? { count: lastRun.steps.reduce((n, s) => n + s.items.length, 0), at: lastRun.at } : null}
                  undoing={undoing}
                  onUndo={undoLast}
                />
              )}

              {accountItems && username && (
                <ReverseCard
                  opts={revOpts}
                  onOpt={(f, v) => setRevOpts((o) => ({ ...o, [f]: v }))}
                  plan={revPlan}
                  checking={revChecking}
                  applying={revApplying}
                  undoing={revUndoing}
                  disabled={syncing || undoing || checking || loadingLib}
                  status={revStatus}
                  onCheck={onReverseCheck}
                  onApply={onReverseApply}
                  lastWrite={
                    revUndo && revUndo.account === stremioAuth?.email
                      ? { count: revUndo.originals.length + revUndo.created.length + revUndo.likes.length, at: revUndo.at }
                      : null
                  }
                  onUndo={onReverseUndo}
                />
              )}
            </div>

            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[320px]">
              <div className="px-4 sm:px-6 py-4 flex flex-wrap gap-3 justify-between items-center">
                <h2 className="text-slate-900 font-bold text-lg">{showPanel && data ? t('panel.items') : t('panel.progress')}</h2>
                {showPanel && data ? (
                  <button onClick={() => setShowPanel(false)} className="text-[11px] text-indigo-600 font-bold hover:underline">
                    {t('panel.back')}
                  </button>
                ) : syncing ? (
                  <span className="animate-pulse text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded font-bold uppercase">{t('panel.syncing')}</span>
                ) : (
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-bold uppercase">
                    {step === 'complete' ? t('panel.completed') : t('panel.waiting')}
                  </span>
                )}
              </div>

              {showPanel && data ? (
                <ItemsPanel
                  data={data}
                  tab={tab}
                  onTab={setTab}
                  typeFilter={typeFilter}
                  onTypeFilter={setTypeFilter}
                  isSelected={isSelected}
                  onSelect={selectItems}
                  onDate={(key, value) => {
                    const d = new Date(value);
                    if (value && !isNaN(d.getTime())) setDateOverrides((o) => ({ ...o, [key]: d.toISOString() }));
                  }}
                  existing={tabDest !== 'skip' ? existing[tabDest] : undefined}
                  disabled={busy}
                />
              ) : (
                <div className="p-6 sm:p-8 min-h-[260px] flex flex-col justify-center border-t border-slate-100">
                  {!data ? (
                    <div className="text-center space-y-4">
                      <div className="w-16 h-16 bg-slate-50 rounded-full border border-slate-100 flex items-center justify-center mx-auto">
                        <LayoutList className={`w-6 h-6 text-slate-300 ${loadingLib ? 'animate-pulse' : ''}`} />
                      </div>
                      <div>
                        <p className="text-slate-800 font-bold">{loadingLib ? t('source.loading') : t('panel.noData')}</p>
                        <p className="text-xs text-slate-500">{loadingLib ? currentAction : t('panel.noDataText')}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      <div className="space-y-4">
                        <div className="flex justify-between items-end gap-4">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-1 truncate">{step === 'complete' ? t('transfer.done') : currentAction || t('panel.ready')}</p>
                            <p className="text-sm font-bold text-slate-800">{t('panel.total')}</p>
                          </div>
                          <p className="text-2xl font-bold text-slate-900" data-testid="progress">{progress}%</p>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                          <div className="h-full bg-indigo-600 transition-[width] duration-300" style={{ width: `${progress}%` }} />
                        </div>
                      </div>

                      {results.length > 0 ? (
                        <div className="space-y-2" data-testid="results">
                          {results.map(({ cat, dest, result }) => (
                            <div key={cat + dest} className="p-3 rounded-lg bg-slate-50 border border-slate-100 flex flex-wrap justify-between gap-2 text-xs">
                              <span className="font-semibold text-slate-800">{`${t(`cat.${cat}`)} → ${destName(dest)}`}</span>
                              <span className={result.notFound.length || result.failedBatches ? 'text-rose-500' : 'text-slate-500'}>
                                {t('panel.result', { added: result.added, existing: result.existing, nf: result.notFound.length })}
                                {result.failedBatches > 0 && t('panel.failed', { n: result.failedBatches })}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                            <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{t('panel.willSend')}</p>
                            <p className="text-xs font-semibold text-slate-800">{t('panel.itemsN', { n: plan.reduce((n, s) => n + s.toSend.length, 0) })}</p>
                          </div>
                          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                            <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{t('panel.destination')}</p>
                            <p className="text-xs font-semibold text-slate-800">{username ? `Trakt · ${username}` : t('panel.notConnected')}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="min-h-10 bg-slate-50 border-t border-slate-200 px-4 sm:px-8 py-2 flex flex-wrap gap-2 items-center justify-between text-[10px] text-slate-400 font-medium uppercase tracking-widest">
          <span className="flex items-center gap-3">
            {t('app.privacy')}
            <span className="normal-case tracking-normal text-slate-300 font-mono" data-testid="version" title="Version">
              v{__APP_VERSION__}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${username ? 'bg-emerald-500' : 'bg-rose-400'}`} />
            Trakt
            <div className={`w-1.5 h-1.5 rounded-full ml-2 ${stremioAuth ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            Stremio
          </div>
        </footer>
      </main>

      <AnimatePresence>
        {device && (
          <AuthModal
            key="auth"
            code={device.userCode}
            url={device.verificationUrl}
            onCancel={() => {
              pollAbort.current?.abort();
              setDevice(null);
            }}
          />
        )}
        {link && (
          <LinkModal
            key="link"
            link={link}
            onCancel={() => {
              linkAbort.current?.abort();
              setLink(null);
            }}
          />
        )}
        {showSettings && <SettingsModal key="settings" initial={keys} onSave={saveKeys} onClose={() => setShowSettings(false)} />}
      </AnimatePresence>
    </div>
  );
}
