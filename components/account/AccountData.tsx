'use client';

/** Розділ «Дані й акаунт» кабінету: вивантаження даних і видалення акаунта з підтвердженням. */

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { profileActions, useSession } from '@/lib/api/hooks/auth';
import { Row } from './AccountParts';
import { useSave } from './useSave';
import s from './account.module.css';

export function AccountData() {
  const t = useTranslations('account.data');
  const router = useRouter();
  const email = useSession().session?.user?.email ?? '';
  const sv = useTranslations('account.save');
  const [confirm, setConfirm] = useState(false);
  const del = useSave();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const download = async () => {
    const res = await profileActions.exportData();
    setDownloadFailed(!res.ok);
    if (!res.ok) return;
    const payload = res.value;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'time2fest-dani.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const remove = async () => {
    if (del.state === 'saving') return;
    const res = await del.run(profileActions.deleteAccount());
    if (res.ok) router.push('/');
  };
  return (
    <section id="data" aria-labelledby="data-h" className={s.card}>
      <h2 id="data-h" className={s.h2}>
        {t('title')}
      </h2>
      <div className={s.rows}>
        <Row title={t('download')} hint={t('downloadHint')}>
          <button type="button" onClick={download} className={cn('t2f-focus', s.link)}>
            <Icon name="arrow-down" size={16} />
            {t('downloadBtn')}
          </button>
        </Row>
        {downloadFailed ? (
          <p className={cn(s.err, s.saveLine)} role="alert">
            <Icon name="alert" size={16} />
            {sv('downloadFailed')}
          </p>
        ) : null}
        <Row title={t('delete')} hint={t('deleteHint')}>
          {confirm ? null : (
            <button type="button" onClick={() => setConfirm(true)} className={cn('t2f-focus', s.link, s.danger)}>
              {t('deleteBtn')}
            </button>
          )}
        </Row>
        <div className="t2f-reveal" data-open={confirm}>
          <div className="t2f-reveal-inner">
            <div className={s.confirm} role="alert">
              <p>{t('deleteConfirm', { email })}</p>
              <div className={s.inlineActs}>
                <button
                  type="button"
                  onClick={remove}
                  aria-busy={del.state === 'saving' || undefined}
                  className={cn('t2f-focus t2f-transition', s.btn, s.dangerBtn)}
                >
                  {del.state === 'saving' ? <span className={s.spin} aria-hidden="true" /> : null}
                  {del.state === 'saving' ? sv('deleting') : t('deleteYes')}
                </button>
                <button type="button" onClick={() => setConfirm(false)} className={cn('t2f-focus', s.link)}>
                  {t('deleteNo')}
                </button>
              </div>
              {del.state === 'failed' ? (
                <p className={cn(s.err, s.saveLine)} role="alert">
                  <Icon name="alert" size={16} />
                  {sv('deleteFailed')}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
