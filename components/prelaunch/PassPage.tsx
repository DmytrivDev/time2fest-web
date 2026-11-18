'use client';

/**
 * «Новорічний пас» мовного дерева — наявна сторінка паса (`/pass/`, `components/pass`) у її наявному вигляді: герой із
 * квитком і ціною, картка оформлення, «Що вмикається одразу після оплати» (плитки з показом), «Питання й відповіді».
 * Прибрано лише можливість оформити: у картці оформлення — наявний стан до запуску оплат «Продаж стане доступний згодом»
 * (той самий блок, що в «Новорічному пасі» головної «до свята», `components/prefest/PassBlock`).
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import pb from '@/components/prefest/PassBlock.module.css';
import { Hero } from '@/components/pass/PassPageParts';
import { PrefestFaqList } from '@/components/prefest/PrefestFaq';
import { PassPerksShowcase } from '@/components/pass/PassPerks';
import ps from '@/components/pass/pass.module.css';
import { SEASON_LABEL } from '@/lib/prelaunch/season';
import type { SiteData } from '@/lib/prelaunch/site';
import { SiteShell } from './SiteShell';

/** Питання сторінки паса, як у `PassPageParts` (`FAQ`). */
const PASS_FAQ = [1, 3, 4] as const;

function Body() {
  const t = useTranslations('pass.page');
  const tp = useTranslations('prefest.pass');
  const tTicket = useTranslations('prelaunch.pass');
  const tf = useTranslations('pass.faq');
  return (
    <div className={ps.main} data-view="soon">
      <Hero
        active={false}
        ticket={{
          brand: `TIME2FEST · ${SEASON_LABEL}`,
          title: tTicket('ticketTitle'),
          season: tTicket('ticketSeason'),
          seasonValue: SEASON_LABEL,
        }}
      />
      <section
        aria-label={t('buyTitle')}
        className={cn('t2f-chat-log t2f-slot-body', ps.card)}
        style={{ gap: 14 }}
        data-block="pass-soon"
      >
        <div className={pb.soonbox}>
          <Icon name="clock" size={20} />
          {tp('soon')}
        </div>
        <span className={pb.fine}>{tp('fine')}</span>
      </section>
      <PassPerksShowcase />
      {/* Питання — у вигляді «Коротко про головне» головної (рішення власника 2026-11-19); ті самі питання сторінки паса. */}
      <PrefestFaqList
        title={tf('title')}
        items={PASS_FAQ.map((n) => ({ id: String(n), question: tf(`q${n}`), answer: tf(`a${n}`) }))}
      />
    </div>
  );
}

export function PassPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="pass" page="S-PL-PASS">
      <Body />
    </SiteShell>
  );
}
