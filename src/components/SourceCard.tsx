import { useRef, useState } from 'react';
import { Link2, LogOut, RefreshCw, Upload, UserRound } from 'lucide-react';
import { useI18n } from '../i18n';
import type { EpisodeDateMode } from '../types';

export type SourceTab = 'account' | 'file';

interface Props {
  tab: SourceTab;
  onTab: (t: SourceTab) => void;
  stremioUser: string | null;
  busy: boolean;
  disabled: boolean;
  onLogin: (email: string, password: string) => void;
  onLink: () => void;
  onReload: () => void;
  onLogout: () => void;
  fileName: string | null;
  onFile: (f: File) => void;
  episodeDate: EpisodeDateMode;
  onEpisodeDate: (m: EpisodeDateMode) => void;
  showEpisodeDate: boolean;
}

export default function SourceCard(p: Props) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const block = p.disabled || p.busy;

  const tabBtn = (id: SourceTab, label: string) => (
    <button
      type="button"
      onClick={() => p.onTab(id)}
      className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${p.tab === id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-slate-900 font-bold text-lg mb-4">{t('source.title')}</h2>
      <div className="flex bg-slate-100 p-1 rounded-lg mb-4" role="tablist">
        {tabBtn('account', t('source.tab.account'))}
        {tabBtn('file', t('source.tab.file'))}
      </div>

      {p.tab === 'account' ? (
        p.stremioUser ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <UserRound className="w-4 h-4 text-violet-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">{t('source.loggedAs')}</p>
                <p className="text-xs font-semibold text-slate-800 truncate" data-testid="stremio-user">{p.stremioUser}</p>
              </div>
              <button onClick={p.onLogout} disabled={block} title={t('status.logout')} className="text-slate-400 hover:text-rose-500 disabled:opacity-40">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={p.onReload}
              disabled={block}
              className="w-full border border-slate-200 text-slate-700 py-2.5 rounded-lg text-xs font-bold hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${p.busy ? 'animate-spin' : ''}`} />
              {p.busy ? t('source.loading') : t('source.reload')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (email && password && !block) p.onLogin(email.trim(), password);
                setPassword('');
              }}
            >
              <input
                type="email"
                placeholder={t('source.email')}
                aria-label={t('source.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <input
                type="password"
                placeholder={t('source.password')}
                aria-label={t('source.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                disabled={block || !email || !password}
                className="w-full bg-violet-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-violet-700 disabled:bg-slate-300"
              >
                {p.busy ? t('source.loading') : t('source.login')}
              </button>
              <p className="text-[10px] text-slate-400">{t('source.passwordNote')}</p>
            </form>
            <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase">
              <div className="h-px bg-slate-200 flex-1" />
              {t('source.or')}
              <div className="h-px bg-slate-200 flex-1" />
            </div>
            <button
              onClick={p.onLink}
              disabled={block}
              className="w-full border border-violet-200 text-violet-700 py-2.5 rounded-lg text-xs font-bold hover:bg-violet-50 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Link2 className="w-3.5 h-3.5" />
              {t('source.link')}
            </button>
            <p className="text-[10px] text-slate-400">{t('source.linkHint')}</p>
          </div>
        )
      ) : (
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => !block && fileInput.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !block && fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && !block) p.onFile(f);
            }}
            className={`cursor-pointer group flex flex-col items-center justify-center p-8 rounded-xl border-2 border-dashed transition-all ${
              dragOver ? 'border-indigo-400 bg-indigo-50' : p.fileName ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-200 hover:border-indigo-300 bg-slate-50/50'
            }`}
          >
            <Upload className={`w-8 h-8 mb-3 transition-transform group-hover:-translate-y-1 ${p.fileName ? 'text-emerald-500' : 'text-slate-400'}`} />
            <p className="text-xs font-bold text-slate-800 text-center break-all">{p.fileName || t('source.drop')}</p>
            <p className="text-[10px] text-slate-500 mt-1">{p.fileName ? t('source.dropAgain') : '.json / .html'}</p>
            <input
              type="file"
              ref={fileInput}
              data-testid="file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) p.onFile(f);
                e.target.value = '';
              }}
              className="hidden"
              accept=".json,.html,.htm,application/json,text/html"
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-3">{t('source.fileHint')}</p>
        </div>
      )}

      {p.showEpisodeDate && (
        <label className="block mt-4 pt-4 border-t border-slate-100">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('source.episodeDate')}</span>
          <select
            value={p.episodeDate}
            disabled={p.disabled}
            onChange={(e) => p.onEpisodeDate(e.target.value as EpisodeDateMode)}
            className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-xs font-semibold text-slate-700 outline-none"
          >
            <option value="released">{t('source.episodeDate.released')}</option>
            <option value="lastWatched">{t('source.episodeDate.lastWatched')}</option>
            <option value="none">{t('source.episodeDate.none')}</option>
          </select>
          <span className="block text-[10px] text-slate-400 mt-1">{t('source.episodeDateHint')}</span>
        </label>
      )}
    </div>
  );
}
