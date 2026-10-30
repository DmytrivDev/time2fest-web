'use client';

/**
 * «Що вмикається одразу після оплати» — плитки можливостей пасу з маленьким прикладом кожної (правка власника
 * 2026-10-29: не однакові інфо-картки, а видно, що саме дає пас). Телефон — стовпчик; планшет — дві колонки;
 * десктоп — сітка 3 колонки, перша плитка на дві (дошки `S-PASS · Новорічний пас · гість`).
 * Приклади декоративні (`aria-hidden`): зміст плитки — у назві й описі.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { cn } from '@/components/primitives/cn';
import { AuthIcon, type AuthIconName } from '@/components/auth/icons';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import s from './pass.module.css';

const UA = 'linear-gradient(#0057B7 50%, #FFD700 50%)';
const AU = 'linear-gradient(#012169, #012169)';
const JP = 'linear-gradient(#FFFFFF 40%, #BC002D 40% 60%, #FFFFFF 60%)';
const EG = 'linear-gradient(#CE1126 33%, #FFFFFF 33% 66%, #000 66%)';

function MiniFlag({ bg, sm }: { bg: string; sm?: boolean }) {
  return <span className={cn(s.flag, sm && s.flagSm)} style={{ background: bg }} />;
}

function MiniChat() {
  const t = useTranslations('pass.perks.mini');
  return (
    <div aria-hidden="true" className={s.mini}>
      <div className={s.miniMsg}>
        <span className={s.miniNick}>
          <MiniFlag bg={EG} />
          Amira
        </span>
        <span>{t('msg1')}</span>
      </div>
      <div className={cn(s.miniMsg, s.miniMine)}>
        <span className={s.miniNick}>
          <MiniFlag bg={UA} />
          {t('nick')}
          <span className={s.miniBadge}>
            <AuthIcon name="ticket" size={9} />
          </span>
        </span>
        <span>{t('msg2')}</span>
      </div>
      <div className={s.miniRoute}>
        <b>{t('route')}</b>
        <span>
          <MiniFlag bg={AU} sm />
          {t('sydney')}
        </span>
        <span className={s.arrow}>→</span>
        <span>
          <MiniFlag bg={JP} sm />
          {t('tokyo')}
        </span>
        <span className={s.arrow}>→</span>
        <span>
          <MiniFlag bg={UA} sm />
          {t('kyiv')}
        </span>
      </div>
    </div>
  );
}

function MiniSchedule() {
  const t = useTranslations('pass.perks.mini');
  const rows = [
    { time: '17:00', city: t('tokyo'), on: false },
    { time: '15:00', city: t('sydney'), on: true },
    { time: '00:00', city: t('kyiv'), on: false },
  ];
  return (
    <div aria-hidden="true" className={s.mini}>
      {rows.map((r) => (
        <div key={r.time} className={cn(s.miniRow, r.on && s.miniRowOn)}>
          <span className={s.miniTime}>{r.time}</span>
          <span className={s.miniCity}>{r.city}</span>
          <span className={s.miniBell}>
            <AuthIcon name="bell" size={14} />
          </span>
        </div>
      ))}
      <div className={s.miniSoon}>{t('soon')}</div>
    </div>
  );
}

function MiniQuiet() {
  const t = useTranslations('pass.perks.mini');
  return (
    <div aria-hidden="true" className={cn(s.mini, s.miniPad)}>
      <div className={s.miniSwitchRow}>
        {t('quiet')}
        <span className={s.miniSwitch} />
      </div>
      <div className={s.miniHidden}>{t('hidden')}</div>
    </div>
  );
}

const STAMPS: [string, number][] = [
  ['#FCE286', -12],
  ['#F94A51', 8],
  ['#8CC7C2', -4],
  ['#FCE286', 14],
  ['#E8837F', -8],
];

function MiniCard() {
  const t = useTranslations('pass.perks.mini');
  return (
    <div aria-hidden="true" className={s.miniCard}>
      <span className={s.miniCardEyebrow}>{t('cardEyebrow')}</span>
      <span className={s.miniCardTitle}>{t('cardTitle')}</span>
      <span className={s.stamps}>
        {STAMPS.map(([color, deg], i) => (
          <span key={i} style={{ color, transform: `rotate(${deg}deg)` }}>
            ★
          </span>
        ))}
      </span>
    </div>
  );
}

function MiniSeat() {
  const t = useTranslations('pass.perks.mini');
  return (
    <div aria-hidden="true" className={s.miniSeat}>
      <AuthIcon name="seat" size={22} />
      <span className={s.miniSeatText}>
        <span className={s.miniSeatLabel}>{t('seat')}</span>
        <span className={s.miniSeatPrice}>
          <s>{formatUsd(PASS_PRICE)}</s>
          <b>{formatUsd(2.49)}</b>
        </span>
      </span>
    </div>
  );
}

export const PASS_PERKS: { key: 'chat' | 'schedule' | 'quiet' | 'card' | 'seat'; icon: AuthIconName; Preview: () => React.JSX.Element }[] = [
  { key: 'chat', icon: 'ticket', Preview: MiniChat },
  { key: 'schedule', icon: 'calendar', Preview: MiniSchedule },
  { key: 'quiet', icon: 'filter', Preview: MiniQuiet },
  { key: 'card', icon: 'card', Preview: MiniCard },
  { key: 'seat', icon: 'seat', Preview: MiniSeat },
];

/** Сторінка пасу: плитки з прикладами. */
export function PassPerksTiles() {
  const t = useTranslations('pass.perks');
  return (
    <section aria-labelledby="pass-perks-title" className={s.perks} data-block="pass-perks">
      <span className={s.eyebrow}>
        <AuthIcon name="spark" size={16} />
        {t('eyebrow')}
      </span>
      <h2 id="pass-perks-title" className={s.perksTitle}>
        {t('title')}
      </h2>
      <ul className={s.tiles}>
        {PASS_PERKS.map(({ key, icon, Preview }) => (
          <li key={key} className={cn(s.gold, s.tile)} data-perk={key}>
            <div className={s.tileText}>
              <span aria-hidden="true" className={cn(s.dot, s.dot40)}>
                <AuthIcon name={icon} size={20} />
              </span>
              <span className={s.tileName}>{t(key)}</span>
              <span className={s.tileDesc}>{t(`${key}Text`)}</span>
            </div>
            <div className={s.tilePreview}>
              <Preview />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Вікно під трансляцією: ціна, назви можливостей і «Усе про пас». */
export function PassPerksCompact() {
  const t = useTranslations('pass.perks');
  const p = useTranslations('pass.page');
  return (
    <section aria-label={t('title')} className={cn(s.gold, s.perksCard)} style={{ borderColor: 'rgba(252,226,134,0.22)' }}>
      <div className={s.priceRow}>
        <span>{formatUsd(PASS_PRICE)}</span>
        <span>{p('priceNote')}</span>
      </div>
      <ul className={s.compact}>
        {PASS_PERKS.map(({ key, icon }) => (
          <li key={key}>
            <span aria-hidden="true" className={cn(s.dot, s.dot28)}>
              <AuthIcon name={icon} size={15} />
            </span>
            {t(key)}
          </li>
        ))}
      </ul>
      <NextLink href="/pass/" className={cn('t2f-focus', s.allLink)}>
        {t('all')}
        <AuthIcon name="arrow-right" size={16} />
      </NextLink>
    </section>
  );
}
