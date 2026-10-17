import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Film, Search } from 'lucide-react';
import { useI18n } from '../i18n';
import { CATEGORIES, type Category, type MigrationData, type StremioItem } from '../types';

export type TypeFilter = 'all' | 'movie' | 'show' | 'episode';

function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function Poster({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-8 h-12 rounded bg-slate-100 flex items-center justify-center shrink-0">
        <Film className="w-3.5 h-3.5 text-slate-300" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-8 h-12 rounded object-cover bg-slate-100 shrink-0"
    />
  );
}

interface Props {
  data: MigrationData;
  tab: Category;
  onTab: (c: Category) => void;
  typeFilter: TypeFilter;
  onTypeFilter: (f: TypeFilter) => void;
  isSelected: (cat: Category, key: string) => boolean;
  onSelect: (cat: Category, keys: string[], selected: boolean) => void;
  onDate: (key: string, value: string) => void;
  existing?: Set<string>;
  disabled: boolean;
}

export default function ItemsPanel(p: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return p.data[p.tab].filter(
      (it) =>
        (p.typeFilter === 'all' || it.type === p.typeFilter) &&
        (!q || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q)),
    );
  }, [p.data, p.tab, p.typeFilter, query]);

  const watchedEpisodes = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of p.data.history) if (it.type === 'episode') m.set(it.id, (m.get(it.id) || 0) + 1);
    return m;
  }, [p.data.history]);

  // Only the visible rows are rendered, so large libraries stay fast.
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 8,
    getItemKey: (i) => filtered[i].key,
  });

  const selectedCount = filtered.filter((it) => p.isSelected(p.tab, it.key)).length;
  const showDate = (it: StremioItem) => it.watchedAt || p.tab === 'history';

  return (
    <>
      <div className="px-4 sm:px-6 pb-3 space-y-2 border-b border-slate-100">
        <div className="flex flex-wrap gap-2 justify-between">
          <div className="flex bg-slate-100 p-1 rounded-lg overflow-x-auto max-w-full">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => p.onTab(c)}
                className={`px-3 py-1 text-[10px] font-bold rounded-md whitespace-nowrap uppercase transition-all ${p.tab === c ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t(`cat.${c}`)} <span className="opacity-60">{p.data[c].length}</span>
              </button>
            ))}
          </div>
          <div className="flex bg-slate-50 p-1 rounded-lg border border-slate-100 overflow-x-auto max-w-full">
            {(['all', 'movie', 'show', 'episode'] as const).map((f) => (
              <button
                key={f}
                onClick={() => p.onTypeFilter(f)}
                className={`px-3 py-1 text-[10px] font-bold rounded-md whitespace-nowrap uppercase transition-all ${p.typeFilter === f ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {t(`type.${f}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('panel.search')}
              aria-label={t('panel.search')}
              className="w-full border border-slate-200 rounded-lg pl-8 pr-2 py-1.5 text-xs outline-none focus:border-indigo-400"
            />
          </div>
          <span className="text-[10px] text-slate-500 font-semibold" data-testid="selected-count">
            {t('panel.selectedOf', { sel: selectedCount, total: filtered.length })}
          </span>
          <button
            disabled={p.disabled}
            onClick={() => p.onSelect(p.tab, filtered.map((i) => i.key), true)}
            className="text-[10px] font-bold text-indigo-600 hover:underline disabled:opacity-40"
          >
            {t('panel.selectAll')}
          </button>
          <button
            disabled={p.disabled}
            onClick={() => p.onSelect(p.tab, filtered.map((i) => i.key), false)}
            className="text-[10px] font-bold text-slate-500 hover:underline disabled:opacity-40"
          >
            {t('panel.selectNone')}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto max-h-[70vh]" data-testid="items-list">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 italic text-xs">{t('panel.empty')}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((v) => {
          const item = filtered[v.index];
          const selected = p.isSelected(p.tab, item.key);
            const inTrakt = p.existing?.has(item.key);
            return (
              <div
                key={item.key}
                data-index={v.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
                className={`px-4 sm:px-6 py-2.5 flex flex-wrap gap-3 items-center justify-between border-b border-slate-50 transition-colors ${selected ? 'hover:bg-slate-50/50' : 'opacity-50'}`}
              >
                <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-indigo-600 shrink-0"
                    checked={selected}
                    disabled={p.disabled}
                    onChange={(e) => p.onSelect(p.tab, [item.key], e.target.checked)}
                    aria-label={item.name}
                  />
                  <Poster src={item.poster} />
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-xs font-bold text-slate-900 leading-tight break-words">{item.name}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[9px] font-mono text-indigo-500 bg-indigo-50 px-1 rounded">{item.id}</span>
                      <span className="text-[9px] text-slate-400 font-medium">{t(`type1.${item.type}`)}</span>
                      {item.type === 'episode' && (
                        <span className="text-[9px] text-slate-500 font-bold bg-slate-100 px-1 rounded">S{item.season}E{item.episode}</span>
                      )}
                      {item.type === 'show' && (
                        <span className="text-[9px] text-slate-500 font-semibold" data-testid="watched-eps">
                          {t('panel.watchedEps', { n: watchedEpisodes.get(item.id) || 0 })}
                        </span>
                      )}
                      {item.rating !== undefined && (
                      <span className="text-[9px] text-amber-700 font-bold bg-amber-50 px-1 rounded">★ {item.rating}</span>
                    )}
                    {item.play !== undefined && (
                      <span className="text-[9px] text-slate-500 font-bold bg-slate-100 px-1 rounded">{t('panel.play', { n: item.play })}</span>
                    )}
                    {item.progress !== undefined && (
                        <span className="text-[9px] text-violet-600 font-bold bg-violet-50 px-1 rounded">{Math.round(item.progress)}%</span>
                      )}
                      {inTrakt && <span className="text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1 rounded">{t('panel.inTrakt')}</span>}
                    </span>
                  </span>
                </label>
                {showDate(item) && (
                  <label className="text-[9px] text-slate-400 font-medium text-right flex flex-col items-end">
                    <span>{p.tab === 'history' ? t('panel.watchDate') : t('panel.activity')}</span>
                    <input
                      type="datetime-local"
                      value={toLocalInput(item.watchedAt)}
                      onChange={(e) => p.onDate(item.key, e.target.value)}
                      disabled={p.disabled}
                      className="bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-[10px] text-indigo-600 font-bold mt-0.5 outline-none focus:border-indigo-400"
                    />
                  </label>
                )}
              </div>
            );
            })}
          </div>
        )}
      </div>
    </>
  );
}
