'use client';

/**
 * Мапа шляху без пасу (рішення власника 2026-11-07, дошки `Desk-Passport-New` кадри 2 і 6): поверх затемненої мапи —
 * картка «Твій шлях на мапі · Щоб побачити свій шлях… потрібен Новорічний пас · Оформити пас · Що дає пас». Те саме на
 * «Моєму графіку» (`variant="schedule"`). На телефоні мапа низька — картка стоїть під нею (CSS).
 */
import { useTranslations } from 'next-intl';
import { usePassDetails, useGetPass } from '@/components/pass/PassWindow';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/primitives/Icon';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import s from './passport.module.css';

export function PathLock({ variant = 'passport' }: { variant?: 'passport' | 'schedule' }) {
  const t = useTranslations('passport.map');
  const getPass = useGetPass();
  const passInfo = usePassDetails();
  const schedule = variant === 'schedule';
  return (
    <div className={s.lock} data-path-lock={variant}>
      <span aria-hidden="true" className={s.lockIcon}>
        <Icon name="lock" size={20} />
      </span>
      <p className={s.lockTitle}>{schedule ? t('lockTitleSchedule') : t('lockTitle')}</p>
      <p className={s.lockText}>{schedule ? t('lockTextSchedule') : t('lockText')}</p>
      <div className={s.lockBtns}>
        <Button variant="coral" compact onClick={() => getPass()}>
          {t('getPass', { price: formatUsd(PASS_PRICE) })}
        </Button>
        <Button variant="secondary" compact onClick={() => passInfo()}>
          {t('passInfo')}
        </Button>
      </div>
    </div>
  );
}
