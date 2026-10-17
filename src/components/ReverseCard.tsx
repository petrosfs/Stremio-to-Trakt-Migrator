import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, ChevronRight, Circle, ScanSearch, Undo2, Upload } from 'lucide-react';
import { useI18n } from '../i18n';
import type { ReverseEntry, ReverseOptions, ReversePlan, ReverseSection } from '../lib/reverse';
import { posterFor } from '../lib/stremio';

interface Props {
  /** Trakt and a Stremio account library are available. */
  ready: boolean;
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

/** Checkbox that can show a partial selection. */
function TriBox({ checked, partial, disabled, label, onChange }: { checked: boolean; partial: boolean; disabled: boolean; label: string; onChange: (v: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="accent-indigo-600 shrink-0"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function Section({
  id,
  label,
  entries,
  value,
  why,
  disabled,
  onToggle,
}: {
  id: ReverseSection;
  label: string;
  entries: ReverseEntry[];
  value: string;
  why: (e: ReverseEntry) => string;
  disabled: boolean;
  onToggle: (keys: string[], include: boolean) => void;
}) {
  const [open, setOpen] = useState(entries.length > 0 && entries.length <= 15);
  const selected = entries.filter((e) => e.included).length;
  return (
    <div className="border-t border-slate-100 first:border-t-0" data-testid={`rev-sec-${id}`}>
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 text-xs">
        {entries.length > 0 ? (
          <TriBox
            label={label}
            checked={selected === entries.length}
            partial={selected > 0 && selected < entries.length}
            disabled={disabled}
            onChange={(v) => onToggle(entries.map((e) => e.key), v)}
          />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <button
          type="button"
          disabled={!entries.length}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center justify-between gap-2 text-left disabled:cursor-default"
        >
          <span className="flex items-center gap-1 text-slate-700 font-semibold">
            {label}
            {entries.length > 0 && <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />}
          </span>
          <span className="font-bold text-indigo-600 whitespace-nowrap">{value}</span>
        </button>
      </div>
      {open && entries.length > 0 && (
        <ul className="max-h-[28rem] overflow-auto pb-2">
          {entries.map((e) => (
            <li key={e.key}>
              <label className="flex items-center gap-3 px-4 sm:px-6 py-1.5 pl-10 sm:pl-12 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="accent-indigo-600 shrink-0"
                  aria-label={e.name}
                  checked={e.included}
                  disabled={disabled}
                  onChange={(ev) => onToggle([e.key], ev.target.checked)}
                />
                <img src={posterFor(e.id)} alt="" loading="lazy" className={`w-7 h-10 rounded object-cover bg-slate-100 shrink-0 ${e.included ? '' : 'opacity-40'}`} />
                <span className="min-w-0">
                  <span className={`block text-xs font-medium ${e.included ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{e.name}</span>
                  <span className="block text-[11px] text-slate-500 break-words">{why(e)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
  const busy = !p.ready || p.disabled || p.checking || p.applying || p.undoing;
  const total = p.plan ? p.plan.changes.length + p.plan.likes.length : 0;

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
            <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1" data-testid="rev-warning">
              <p className="font-bold">{t('reverse.warnTitle')}</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>{t('reverse.warn1')}</li>
                <li>{t('reverse.warn2')}</li>
                <li>{t('reverse.warn3')}</li>
                <li>{t('reverse.warn4')}</li>
              </ul>
            </div>
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

interface PreviewProps {
  plan: ReversePlan | null;
  need: { trakt: boolean; stremio: boolean; library: boolean };
  checking: boolean;
  disabled: boolean;
  onToggle: (keys: string[], include: boolean) => void;
}

/** Right-hand panel of the Trakt → Stremio tab: what is needed, then every title with its reason. */
export function ReversePreview(p: PreviewProps) {
  const { t } = useI18n();
  const s = p.plan?.summary;
  const total = p.plan ? p.plan.changes.length + p.plan.likes.length : 0;
  const ready = p.need.trakt && p.need.stremio && p.need.library;

  const why = (e: ReverseEntry) => {
    if (e.reason === 'episodes') {
      const eps = e.episodes || [];
      return `+${eps.length}: ${eps.slice(0, 12).join(', ')}${eps.length > 12 ? '…' : ''}`;
    }
    if (e.reason === 'like') return `Trakt ★${e.rating} → ${e.status === 'loved' ? 'Loved' : 'Liked'}`;
    const text = t(`reverse.why.${e.reason}`);
    return e.plays && e.plays > 1 ? `${text} · ${t('reverse.plays', { n: e.plays })}` : text;
  };
  const bySection = (sec: ReverseSection) => p.plan?.entries.filter((e) => e.section === sec) || [];
  const count = (sec: ReverseSection) => {
    const list = bySection(sec);
    const sel = list.filter((e) => e.included).length;
    return sel === list.length ? String(list.length) : `${sel}/${list.length}`;
  };
  const sectionProps = (sec: ReverseSection) => ({ id: sec, entries: bySection(sec), why, disabled: p.disabled, onToggle: p.onToggle });

  const need = (ok: boolean, label: string) => (
    <li className="flex items-center gap-2 text-xs">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-300 shrink-0" />}
      <span className={ok ? 'text-slate-500' : 'text-slate-800 font-semibold'}>{label}</span>
    </li>
  );

  return (
    <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[320px]">
      <div className="px-4 sm:px-6 py-4 flex flex-wrap gap-3 justify-between items-center border-b border-slate-100">
        <h2 className="text-slate-900 font-bold text-lg">{t('reverse.preview')}</h2>
        {p.plan && (
          <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-bold uppercase">{t('reverse.toWrite', { n: total })}</span>
        )}
      </div>
      {!ready ? (
        <div className="p-6 sm:p-8 flex-1 flex flex-col justify-center items-center">
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-800">{t('reverse.need')}</p>
            <ul className="space-y-2" data-testid="rev-need">
              {need(p.need.trakt, t('reverse.needTrakt'))}
              {need(p.need.stremio, t('reverse.needStremio'))}
              {need(p.need.library, t('reverse.needLibrary'))}
            </ul>
          </div>
        </div>
      ) : !p.plan || !s ? (
        <div className="p-6 sm:p-8 flex-1 flex flex-col justify-center items-center text-center gap-3">
          <div className="w-16 h-16 bg-slate-50 rounded-full border border-slate-100 flex items-center justify-center">
            <ScanSearch className={`w-6 h-6 text-slate-300 ${p.checking ? 'animate-pulse' : ''}`} />
          </div>
          <p className="text-xs text-slate-500 max-w-xs">{p.checking ? t('reverse.checking') : t('reverse.empty')}</p>
        </div>
      ) : (
        <div data-testid="reverse-plan">
          <Section {...sectionProps('library')} label={t('reverse.addLib')} value={count('library')} />
          <Section {...sectionProps('movies')} label={t('reverse.movies')} value={count('movies')} />
          <Section
            {...sectionProps('episodes')}
            label={t('reverse.episodes')}
            value={t('reverse.episodesIn', { n: s.episodesWatched, s: s.seriesUpdated.length })}
          />
          <Section {...sectionProps('likes')} label={t('reverse.likesN')} value={count('likes')} />
          {s.seriesWithoutEpisodes.length > 0 && (
            <p className="px-4 sm:px-6 py-2 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100">
              {t('reverse.noEpisodes', { list: s.seriesWithoutEpisodes.slice(0, 20).join(', ') + (s.seriesWithoutEpisodes.length > 20 ? '…' : '') })}
            </p>
          )}
          {p.plan.entries.length === 0 && <p className="px-4 sm:px-6 py-3 text-xs text-slate-500 border-t border-slate-100">{t('reverse.nothing')}</p>}
          {p.plan.entries.length > 0 && total === 0 && (
            <p className="px-4 sm:px-6 py-3 text-xs text-slate-500 border-t border-slate-100">{t('reverse.noneSelected')}</p>
          )}
        </div>
      )}
    </div>
  );
}
