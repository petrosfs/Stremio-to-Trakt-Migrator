import { useState } from 'react';
import { Copy, ExternalLink, KeyRound } from 'lucide-react';
import Modal from './Modal';
import type { TraktKeys } from '../types';
import { useI18n } from '../i18n';

const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';

function CopyField({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 bg-slate-100 rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-700 break-all">
      {value}
      <button
        type="button"
        title={t('settings.copy')}
        className="text-slate-400 hover:text-indigo-600 shrink-0"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }).catch(() => {});
        }}
      >
        {copied ? <span className="text-emerald-600 text-[10px] font-sans font-bold">✓</span> : <Copy className="w-3 h-3" />}
      </button>
    </span>
  );
}

export default function SettingsModal({
  initial,
  onSave,
  onClose,
}: {
  initial: TraktKeys | null;
  onSave: (keys: TraktKeys) => void;
  onClose: () => void;
}) {
  const [clientId, setClientId] = useState(initial?.clientId || '');
  const [clientSecret, setClientSecret] = useState(initial?.clientSecret || '');
  const { t } = useI18n();
  const origin = window.location.origin;
  const valid = clientId.trim().length > 10 && clientSecret.trim().length > 10;

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-indigo-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">{t('settings.title')}</h2>
      </div>

      <ol className="text-xs text-slate-600 space-y-2 mb-5 list-decimal pl-4">
        <li>
          {t('settings.s1a')}{' '}
          <a
            href="https://trakt.tv/oauth/applications/new"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-600 font-semibold hover:underline inline-flex items-center gap-0.5"
          >
            trakt.tv → New Application <ExternalLink className="w-3 h-3" />
          </a>{' '}
          {t('settings.s1b')}
        </li>
        <li>{t('settings.s2')}</li>
        <li>Redirect URI: <CopyField value={REDIRECT} /></li>
        <li>Javascript (CORS) origins: <CopyField value={origin} /></li>
        <li>{t('settings.s5')}</li>
      </ol>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
        }}
      >
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Client ID</span>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Client Secret</span>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400"
          />
        </label>
        <p className="text-[11px] text-slate-500">
          {t('settings.note')}
        </p>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-50"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:bg-slate-300"
          >
            {t('settings.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
