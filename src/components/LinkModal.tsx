import { ChevronRight } from 'lucide-react';
import Modal from './Modal';
import { useI18n } from '../i18n';
import type { LinkCode } from '../lib/stremio';

export default function LinkModal({ link, onCancel }: { link: LinkCode; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <Modal>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{t('link.title')}</h2>
        <p className="text-slate-500 text-sm mb-5">{t('link.text')}</p>
        <div className="bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 px-6 mb-4 inline-block select-all">
          <span className="text-3xl sm:text-4xl font-black tracking-[0.2em] text-violet-600 font-mono">{link.code}</span>
        </div>
        {link.qrcode && (
          <img src={link.qrcode} alt="" width={140} height={140} className="mx-auto mb-4 rounded-lg border border-slate-100" />
        )}
        <p className="text-[11px] text-slate-400 mb-5 animate-pulse">{t('link.waiting')}</p>
        <div className="space-y-3">
          <a
            href={link.link}
            target="_blank"
            rel="noreferrer"
            className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
          >
            {t('link.open')}
            <ChevronRight className="w-4 h-4" />
          </a>
          <button onClick={onCancel} className="w-full text-slate-400 text-xs font-medium hover:text-slate-600 py-1">
            {t('auth.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
