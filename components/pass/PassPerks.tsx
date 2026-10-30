'use client';

/**
 * «Що вмикається одразу після оплати» — вітрина можливостей пасу з порівнянням «без пасу / з пасом» і прикладом
 * кожної (`PassPerksShowcase`), і короткий список для вікна під трансляцією (`PassPerksCompact`).
 * Приклади декоративні (`aria-hidden`): зміст — у назві, порівнянні й описі.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useId, useState } from 'react';
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

type PerkKey = (typeof PASS_PERKS)[number]['key'];

/** Ціна місця в «Першому ряду» без пасу й з пасом (−50%), як у прикладі `MiniSeat`. */
const SEAT_FULL = 4.99;
const SEAT_HALF = 2.49;

/** «Без пасу → з пасом» для рядка списку й плашок вибраної можливості. */
function useCompare() {
  const t = useTranslations('pass.perks');
  return (key: PerkKey) =>
    key === 'seat'
      ? { without: t('seatWithout', { full: formatUsd(SEAT_FULL) }), with: t('seatWith', { half: formatUsd(SEAT_HALF) }) }
      : { without: t(`${key}Without`), with: t(`${key}With`) };
}

/** Вибрана можливість: назва, «без пасу / з пасом», опис і великий приклад. */
function PerkPanel({ perk, id, inline }: { perk: (typeof PASS_PERKS)[number]; id: string; inline?: boolean }) {
  const t = useTranslations('pass.perks');
  const cmp = useCompare()(perk.key);
  const { Preview } = perk;
  return (
    <div id={id} className={cn(s.perkPanel, inline ? s.perkPanelInline : s.perkPanelSide)} data-panel={perk.key}>
      {/* на телефоні назва вже в рядку над панеллю */}
      {inline ? null : <h3 className={s.perkPanelTitle}>{t(perk.key)}</h3>}
      <div className={s.perkChips}>
        <div className={s.perkChip}>
          <span className={s.perkChipLabel}>{t('without')}</span>
          <span className={s.perkChipValue}>
            <AuthIcon name="minus" size={16} />
            {cmp.without}
          </span>
        </div>
        <div className={cn(s.perkChip, s.perkChipOn)}>
          <span className={s.perkChipLabel}>{t('with')}</span>
          <span className={s.perkChipValue}>
            <AuthIcon name="tick" size={16} />
            {cmp.with}
          </span>
        </div>
      </div>
      <p className={s.perkPanelDesc}>{t(`${perk.key}Text`)}</p>
      <div className={s.perkPanelPreview}>
        <Preview />
      </div>
    </div>
  );
}

/**
 * Сторінка пасу: вітрина з порівнянням (вибір власника 2026-10-30, дошка `S-PASS · «Що вмикається…» — гібрид Ґ`).
 * Ліворуч список «назва + без → з», праворуч вибрана можливість. Телефон і планшет — той самий список, вибрана
 * розгортається під своїм рядком. Один шаблон для обох — кнопки-розкривачки (`aria-expanded`), відкрита завжди одна.
 */
export function PassPerksShowcase() {
  const t = useTranslations('pass.perks');
  const compare = useCompare();
  const uid = useId();
  const [active, setActive] = useState<PerkKey>('chat');
  const current = PASS_PERKS.find((p) => p.key === active);
  return (
    <section aria-labelledby="pass-perks-title" className={s.perks} data-block="pass-perks">
      <span className={s.eyebrow}>
        <AuthIcon name="spark" size={16} />
        {t('eyebrow')}
      </span>
      <h2 id="pass-perks-title" className={s.perksTitle}>
        {t('title')}
      </h2>
      <p className={s.perksFree}>
        <span aria-hidden="true" className={s.perksFreeDot}>
          <AuthIcon name="chat" size={15} />
        </span>
        {t('free')}
      </p>
      <div className={cn(s.gold, s.showcase)}>
        <ul className={s.perkList}>
          {PASS_PERKS.map((perk) => {
            const on = perk.key === active;
            const cmp = compare(perk.key);
            return (
              <li key={perk.key} data-perk={perk.key}>
                <button
                  type="button"
                  aria-expanded={on}
                  aria-controls={`${uid}-side ${uid}-${perk.key}`}
                  className={cn('t2f-focus', s.perkItem, on && s.perkItemOn)}
                  onClick={() => setActive(perk.key)}
                >
                  <span aria-hidden="true" className={cn(s.dot, s.dot36, !on && s.dotGrey)}>
                    <AuthIcon name={perk.icon} size={18} />
                  </span>
                  <span className={s.perkItemText}>
                    <span className={s.perkItemName}>{t(perk.key)}</span>
                    <span className={s.perkItemCmp}>
                      {cmp.without} → <span className={s.perkItemWith}>{cmp.with}</span>
                    </span>
                  </span>
                </button>
                {on ? <PerkPanel perk={perk} id={`${uid}-${perk.key}`} inline /> : null}
              </li>
            );
          })}
        </ul>
        {current ? <PerkPanel perk={current} id={`${uid}-side`} /> : null}
      </div>
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
