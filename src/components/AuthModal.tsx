import { ChevronRight, Settings } from 'lucide-react';
import Modal from './Modal';
import { useI18n } from '../i18n';

export default function AuthModal({
  code,
  url,
  onCancel,
}: {
  code: string;
  url: string;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal>
      <div className="text-center">
        <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Settings className="w-8 h-8 text-indigo-600 animate-spin-slow" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{t('auth.title')}</h2>
        <p className="text-slate-500 text-sm mb-6">
          {t('auth.text')}
        </p>
        <div className="bg-slate-50 border-2 border-slate-100 rounded-2xl py-5 px-6 mb-6 inline-block select-all">
          <span className="text-3xl sm:text-4xl font-black tracking-[0.2em] text-indigo-600 font-mono">{code}</span>
        </div>
        <p className="text-[11px] text-slate-400 mb-6 animate-pulse">{t('auth.waiting')}</p>
        <div className="space-y-3">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
          >
            {t('auth.open')}
            <ChevronRight className="w-4 h-4" />
          </a>
          <button
            onClick={onCancel}
            className="w-full text-slate-400 text-xs font-medium hover:text-slate-600 transition-colors py-1"
          >
            {t('auth.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
