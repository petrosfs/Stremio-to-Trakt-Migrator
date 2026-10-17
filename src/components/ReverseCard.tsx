import { useEffect, useState } from 'react';
import { ArrowLeftRight, ScanSearch, Undo2, Upload } from 'lucide-react';
import { useI18n } from '../i18n';
import type { ReverseOptions, ReversePlan } from '../lib/reverse';

interface Props {
  opts: ReverseOptions;
  onOpt: (field: keyof ReverseOptions, v: boolean) => void;
  plan: ReversePlan | null;
  checking: boolean;
  applying: boolean;
  undoing: boolean;
  disabled: boolean;
  status: string;
  onCheck: () => void;
  onApply: () => void;
  lastWrite: { count: number; at: number } | null;
  onUndo: () => void;
}

function useConfirm() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const id = setTimeout(() => setOn(false), 4000);
    return () => clearTimeout(id);
  }, [on]);
  return [on, setOn] as const;
}

export default function ReverseCard(p: Props) {
  const { t, lang } = useI18n();
  const [confirmApply, setConfirmApply] = useConfirm();
  const [confirmUndo, setConfirmUndo] = useConfirm();
  const busy = p.disabled || p.checking || p.applying || p.undoing;
  const total = p.plan ? p.plan.changes.length + p.plan.likes.length : 0;
  const s = p.plan?.summary;

  const box = (field: keyof ReverseOptions) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="accent-indigo-600"
        checked={p.opts[field]}
        disabled={busy}
        data-testid={`rev-${field}`}
        onChange={(e) => p.onOpt(field, e.target.checked)}
      />
      <span className="text-xs font-semibold text-slate-700">{t(`reverse.${field}`)}</span>
    </label>
  );

  const line = (label: string, value: string | number, names?: string[]) => (
    <details className="border-t border-slate-100 first:border-t-0">
      <summary className={`flex justify-between gap-2 px-3 py-1.5 text-[11px] ${names?.length ? 'cursor-pointer' : 'list-none'}`}>
        <span className="text-slate-700 font-semibold">{label}</span>
        <span className="font-bold text-indigo-600">{value}</span>
      </summary>
      {names && names.length > 0 && (
        <p className="px-3 pb-2 text-[10px] text-slate-500 break-words">
          {names.slice(0, 60).join(', ')}
          {names.length > 60 ? '…' : ''}
        </p>
      )}
    </details>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="reverse">
      <h2 className="text-slate-900 font-bold text-lg mb-1 flex items-center gap-2">
        <ArrowLeftRight className="w-4 h-4 text-indigo-500" />
        {t('reverse.title')}
      </h2>
      <p className="text-[11px] text-slate-500 mb-4">{t('reverse.hint')}</p>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 mb-3">
        {box('watchlist')}
        {box('watched')}
        {box('likes')}
      </div>

      {p.plan && s && (
        <div className="border border-slate-200 rounded-lg overflow-hidden mb-3" data-testid="reverse-plan">
          {line(t('reverse.addLib'), s.addedToLibrary.length, s.addedToLibrary)}
          {line(t('reverse.movies'), s.moviesWatched.length, s.moviesWatched)}
          {line(t('reverse.episodes'), t('reverse.episodesIn', { n: s.episodesWatched, s: s.seriesUpdated.length }), s.seriesUpdated)}
          {line(t('reverse.likesN'), p.plan.likes.length, p.plan.likes.map((l) => `${l.name} (${l.status === 'loved' ? 'Loved' : 'Liked'})`))}
          {s.seriesWithoutEpisodes.length > 0 && (
            <p className="px-3 py-2 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-100">
              {t('reverse.noEpisodes', { list: s.seriesWithoutEpisodes.slice(0, 20).join(', ') + (s.seriesWithoutEpisodes.length > 20 ? '…' : '') })}
            </p>
          )}
          {total === 0 && <p className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100">{t('reverse.nothing')}</p>}
        </div>
      )}

      <div className="space-y-3">
        <button
          onClick={p.onCheck}
          disabled={busy || !(p.opts.watchlist || p.opts.watched || p.opts.likes)}
          data-testid="rev-check"
          className="w-full border border-slate-200 text-slate-700 py-2.5 rounded-lg text-xs font-bold hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <ScanSearch className={`w-4 h-4 ${p.checking ? 'animate-pulse' : ''}`} />
          {p.checking ? t('reverse.checking') : t('reverse.check')}
        </button>

        {p.plan && total > 0 && (
          <>
            <button
              onClick={() => {
                if (confirmApply) {
                  setConfirmApply(false);
                  p.onApply();
                } else setConfirmApply(true);
              }}
              disabled={busy}
              data-testid="rev-apply"
              className={`w-full py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 disabled:bg-slate-300 ${
                confirmApply ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              <Upload className="w-4 h-4" />
              {p.applying ? t('reverse.applying') : confirmApply ? t('reverse.applyConfirm') : `${t('reverse.apply')} (${total})`}
            </button>
            <p className="text-[10px] text-slate-400 text-center">{t('reverse.backupHint')}</p>
          </>
        )}
        {p.status && <p className="text-[10px] text-indigo-600 font-bold text-center">{p.status}</p>}
      </div>

      {p.lastWrite && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <button
            disabled={busy}
            data-testid="rev-undo"
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
            {p.undoing ? t('transfer.undoing') : confirmUndo ? t('transfer.undoConfirm') : t('reverse.undo')}
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-1">
            {t('reverse.undoInfo', {
              n: p.lastWrite.count,
              date: new Date(p.lastWrite.at).toLocaleString(lang === 'el' ? 'el-GR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
