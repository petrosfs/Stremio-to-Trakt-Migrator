import { LogOut } from 'lucide-react';
import logo from '../assets/logo.svg';
import { useI18n } from '../i18n';
import type { LogEntry } from '../types';

interface Props {
  logs: LogEntry[];
  traktUser: string | null;
  stremioUser: string | null;
  onTraktLogout: () => void;
  onStremioLogout: () => void;
}

export default function Sidebar({ logs, traktUser, stremioUser, onTraktLogout, onStremioLogout }: Props) {
  const { t, lang } = useI18n();
  const account = (label: string, user: string | null, onLogout: () => void, color: string) => (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${color}`}>{label}</p>
        <p className={`text-xs truncate ${user ? 'text-slate-300 font-medium' : 'text-slate-500'}`}>{user || t('status.notConnected')}</p>
      </div>
      {user && (
        <button onClick={onLogout} title={t('status.logout')} className="text-slate-500 hover:text-rose-400 transition-colors shrink-0">
          <LogOut className="w-3 h-3" />
        </button>
      )}
    </div>
  );

  return (
    <aside className="order-last lg:order-first lg:w-80 lg:h-screen lg:sticky lg:top-0 bg-slate-900 flex flex-col shrink-0">
      <div className="p-6 hidden lg:flex items-center gap-3">
        <img src={logo} alt="" width={32} height={32} className="w-8 h-8" />
        <span className="text-white font-bold tracking-tight uppercase text-sm">Stremio2Trakt</span>
      </div>

      <div className="flex-1 px-4 pt-6 lg:pt-0 overflow-hidden flex flex-col">
        <div className="mb-6">
          <span className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('log.title')}</span>
          <div
            className="mt-2 bg-slate-800/50 rounded-xl p-4 h-56 lg:h-64 overflow-y-auto font-mono text-[10px] space-y-2 custom-scrollbar border border-slate-700/50"
            data-testid="log"
            aria-live="polite"
          >
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">{t('log.empty')}</p>
            ) : (
              logs.map((log, i) => (
                <div key={`${log.time}-${i}`} className="flex gap-2">
                  <span className="text-slate-600 shrink-0">
                    [{new Date(log.time).toLocaleTimeString(lang === 'el' ? 'el-GR' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
                  </span>
                  <span className={log.kind === 'ok' ? 'text-emerald-400' : log.kind === 'err' ? 'text-rose-400' : 'text-slate-300'}>{log.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <nav className="flex-1 px-4 pb-6">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('steps.title')}</span>
          <ul className="mt-4 space-y-4">
            {[1, 2, 3, 4].map((n) => (
              <li key={n} className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-slate-800 text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">{n}</div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">{t(`steps.${n}.t`)}</p>
                  <p className="text-[10px] text-slate-500">{t(`steps.${n}.d`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="p-6 border-t border-slate-800">
        <div className="bg-indigo-600/10 p-4 rounded-xl border border-indigo-500/20 space-y-3">
          {account('Trakt', traktUser, onTraktLogout, 'text-indigo-400')}
          {account('Stremio', stremioUser, onStremioLogout, 'text-violet-400')}
        </div>
      </div>
    </aside>
  );
}
