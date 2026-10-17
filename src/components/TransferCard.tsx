import { useEffect, useState } from 'react';
import { CheckCircle2, FileJson, FileSpreadsheet, Play, ScanSearch, Square, Undo2 } from 'lucide-react';
import { useI18n } from '../i18n';
import type { PlanStep } from '../lib/sync';
import type { Destination, TraktList } from '../types';

export type Prefs = { library: Destination; watchlist: Destination; continue: Destination; history: Destination; rated: Destination };
export type Step = 'idle' | 'ready' | 'syncing' | 'complete';

interface Props {
  connected: boolean;
  lists: TraktList[];
  prefs: Prefs;
  onPref: (field: keyof Prefs, value: Destination) => void;
  skipExisting: boolean;
  onSkipExisting: (v: boolean) => void;
  lastSyncAt: string | null;
  onlyNew: boolean;
  onOnlyNew: (v: boolean) => void;
  plan: PlanStep[];
  destName: (d: Destination) => string;
  checking: boolean;
  onCheck: () => void;
  step: Step;
  onSync: () => void;
  onStop: () => void;
  onAgain: () => void;
  onZip: () => void;
  onCsv: () => void;
  lastRun: { count: number; at: number } | null;
  undoing: boolean;
  onUndo: () => void;
}

export default function TransferCard(p: Props) {
  const { t, lang } = useI18n();
  const [confirmUndo, setConfirmUndo] = useState(false);
  const syncing = p.step === 'syncing';
  const busy = syncing || p.checking || p.undoing;
  const toSend = p.plan.reduce((n, s) => n + s.toSend.length, 0);

  useEffect(() => {
    if (!confirmUndo) return;
    const id = setTimeout(() => setConfirmUndo(false), 4000);
    return () => clearTimeout(id);
  }, [confirmUndo]);

  const select = (field: keyof Prefs, allowHistory = false) => (
    <select
      data-testid={`dest-${field}`}
      className="bg-white border border-slate-200 rounded px-2 py-1 text-xs font-bold text-indigo-600 outline-none max-w-[160px]"
      value={p.prefs[field]}
      disabled={busy}
      onChange={(e) => p.onPref(field, e.target.value)}
    >
      <option value="skip">{t('transfer.skip')}</option>
      {field === 'rated' ? (
        <option value="ratings">{t('transfer.ratings')}</option>
      ) : (
        <>
          {field !== 'library' && <option value="watchlist">Watchlist</option>}
          {allowHistory && <option value="history">History</option>}
          {field === 'continue' && <option value="playback">{t('transfer.playback')}</option>}
          {p.lists.map((l) => (
            <option key={l.id} value={String(l.id)}>{l.name}</option>
          ))}
        </>
      )}
    </select>
  );

  const row = (field: keyof Prefs, label: string, allowHistory = false) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold text-slate-700">{label} →</span>
      {select(field, allowHistory)}
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-slate-900 font-bold text-lg mb-4">{t('transfer.title')}</h2>

      {p.step === 'complete' ? (
        <div className="flex flex-col items-center text-center mb-4">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          </div>
          <p className="text-sm font-bold text-slate-900">{t('transfer.done')}</p>
          <p className="text-xs text-slate-500 mb-3">{t('transfer.doneText')}</p>
          <button onClick={p.onAgain} className="text-[11px] text-indigo-600 font-bold hover:underline">
            {t('transfer.again')}
          </button>
        </div>
      ) : p.connected ? (
        <div className="space-y-3 mb-3">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('transfer.dests')}</p>
            {row('library', t('cat.collection'))}
            {row('watchlist', t('cat.watchlist'))}
            {row('continue', t('cat.continueWatching'))}
            {row('history', t('cat.history'), true)}
            {row('rated', t('cat.rated'))}
            <p className="text-[10px] text-slate-400">{t('transfer.collectionHint')}</p>
            {p.prefs.continue === 'playback' && <p className="text-[10px] text-slate-400">{t('transfer.playbackHint')}</p>}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-indigo-600"
                checked={p.skipExisting}
                disabled={busy}
                onChange={(e) => p.onSkipExisting(e.target.checked)}
              />
              <span>
                <span className="block text-xs font-semibold text-slate-700">{t('transfer.skipExisting')}</span>
                <span className="block text-[10px] text-slate-400">{t('transfer.skipExistingHint')}</span>
              </span>
            </label>
          </div>

          {p.lastSyncAt && (
            <label className="flex items-start gap-2 cursor-pointer bg-slate-50 border border-slate-200 rounded-lg p-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-indigo-600"
                checked={p.onlyNew}
                disabled={busy}
                data-testid="only-new"
                onChange={(e) => p.onOnlyNew(e.target.checked)}
              />
              <span>
                <span className="block text-xs font-semibold text-slate-700">{t('transfer.onlyNew')}</span>
                <span className="block text-[10px] text-slate-400">
                  {t('transfer.onlyNewHint', {
                    date: new Date(p.lastSyncAt).toLocaleString(lang === 'el' ? 'el-GR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }),
                  })}
                </span>
              </span>
            </label>
          )}

          {p.plan.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="plan">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-3 pt-3">{t('plan.title')}</p>
              <table className="w-full table-fixed text-[11px] mt-2">
                <colgroup>
                  <col />
                  <col className="w-[3.75rem]" />
                  <col className="w-[3.75rem]" />
                  <col className="w-[3.75rem]" />
                </colgroup>
                <thead>
                  <tr className="text-slate-400 text-left align-bottom">
                    <th className="font-medium px-3 py-1" />
                    <th className="font-medium text-[10px] leading-tight px-1 py-1 text-right">{t('plan.selected')}</th>
                    <th className="font-medium text-[10px] leading-tight px-1 py-1 text-right">{t('plan.existing')}</th>
                    <th className="font-medium text-[10px] leading-tight pl-1 pr-3 py-1 text-right">{t('plan.toSend')}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.plan.map((s) => (
                    <tr key={s.label + s.dest} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 text-slate-700 break-words">
                        <span className="font-semibold">{s.label}</span>
                        <span className="text-slate-400"> → {p.destName(s.dest)}</span>
                      </td>
                      <td className="px-1 py-1.5 text-right text-slate-600">{s.items.length}</td>
                      <td className="px-1 py-1.5 text-right text-slate-400">{s.existing === null ? '–' : s.existing}</td>
                      <td className="pl-1 pr-3 py-1.5 text-right font-bold text-indigo-600">{s.toSend.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {p.skipExisting && p.plan.some((s) => s.existing === null) && (
                <p className="text-[10px] text-slate-400 px-3 pb-2">– {t('plan.unchecked')}</p>
              )}
            </div>
          )}

          {p.skipExisting && (
            <button
              onClick={p.onCheck}
              disabled={busy || !p.plan.length}
              className="w-full border border-slate-200 text-slate-700 py-2.5 rounded-lg text-xs font-bold hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <ScanSearch className={`w-4 h-4 ${p.checking ? 'animate-pulse' : ''}`} />
              {p.checking ? t('transfer.checking') : t('transfer.check')}
            </button>
          )}

          {syncing ? (
            <button
              onClick={p.onStop}
              className="w-full bg-rose-600 text-white py-3 rounded-lg font-bold text-sm hover:bg-rose-700 flex items-center justify-center gap-2"
            >
              <Square className="w-4 h-4 fill-current" />
              {t('transfer.stop')}
            </button>
          ) : (
            <button
              disabled={busy || !p.plan.length || (p.plan.every((s) => s.existing !== null) && toSend === 0)}
              onClick={p.onSync}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold text-sm hover:bg-indigo-700 shadow-md shadow-indigo-100 flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:shadow-none"
            >
              <Play className="w-4 h-4 fill-current" />
              {t('transfer.sync')}
            </button>
          )}
          {!p.plan.length && <p className="text-[11px] text-slate-400 text-center">{t('transfer.nothing')}</p>}
        </div>
      ) : (
        <p className="text-xs text-slate-500 mb-4">{t('transfer.loginFirst')}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          disabled={busy}
          onClick={p.onZip}
          className="bg-white text-slate-700 border border-slate-200 py-2.5 rounded-lg font-bold text-xs hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <FileJson className="w-4 h-4 text-indigo-500" />
          {t('transfer.zip')}
        </button>
        <button
          disabled={busy}
          onClick={p.onCsv}
          className="bg-white text-slate-700 border border-slate-200 py-2.5 rounded-lg font-bold text-xs hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
          {t('transfer.csv')}
        </button>
      </div>

      {p.connected && p.lastRun && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <button
            disabled={busy}
            onClick={() => {
              if (confirmUndo) {
                setConfirmUndo(false);
                p.onUndo();
              } else setConfirmUndo(true);
            }}
            className={`w-full py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 border disabled:opacity-50 ${
              confirmUndo ? 'bg-rose-600 text-white border-rose-600' : 'text-rose-600 border-rose-200 hover:bg-rose-50'
            }`}
          >
            <Undo2 className="w-3.5 h-3.5" />
            {p.undoing ? t('transfer.undoing') : confirmUndo ? t('transfer.undoConfirm') : t('transfer.undo')}
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-1">
            {t('transfer.undoInfo', {
              n: p.lastRun.count,
              date: new Date(p.lastRun.at).toLocaleString(lang === 'el' ? 'el-GR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
