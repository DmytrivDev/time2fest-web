/**
 * Скелетони сторінок поза `(live)` (2026-11-10): вхід і реєстрація, пас, службові сторінки, «Про нас». У них немає
 * спільного макета, тож шапку малюємо тут (розміри `Header`: лого й навігація — справжні, праворуч — бруски на місці «Пасу»
 * й капсули, бо вхід і пас відомі лише в браузері). Без `'use client'` і без клієнтських компонентів: скелетон показується
 * одразу, не чекаючи JS. Сітка — копія розмірів модулів сторінок (`static.module.css`; модулі сторінок не імпортуємо — це
 * міняло порядок каскаду на самих сторінках), тож бруски стоять там, де стане вміст. Футер не малюємо.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Bar, Frame, Grid, Grow, Row, cx } from './parts';
import sk from './skeleton.module.css';
import st from './static.module.css';

/** Шапка-скелетон (розміри й відступи — з `header.module.css`). */
function HeaderSkeleton({ current }: { current?: 'about' }) {
  const t = useTranslations('header');
  return (
    <header aria-hidden="true" className={st.header}>
      <div className={st.bar}>
        <span className={st.logo}>
          {/* eslint-disable-next-line @next/next/no-img-element -- статичний експорт; те саме зображення, що в шапці */}
          <img src="/brand/logo.png" alt="" width={150} height={43} />
        </span>
        <span className={st.nav}>
          <span className={st.navLink}>{t('home')}</span>
          <span className={st.navLink}>{t('countries')}</span>
          <span className={st.navLink} aria-current={current === 'about' ? 'page' : undefined}>
            {t('about')}
          </span>
        </span>
        <span className={st.spacer} />
        <span className={cx(st.text, st.deskOnly)}>
          <Bar w={100} h={18} />
        </span>
        <Bar shape="pill" w={[60, 175, 175]} h={[38, 40, 40]} className={st.pass} />
        <span className={st.mine}>
          <Bar shape="pill" w={[124, 228, 228]} h={[36, 36, 36]} className={sk.headerMine} />
        </span>
      </div>
    </header>
  );
}

function Shell({ kind, header, children }: { kind: string; header: ReactNode; children: ReactNode }) {
  const t = useTranslations('common');
  return (
    <div aria-busy="true" data-skeleton={kind} className="flex min-h-dvh flex-col bg-background text-text">
      {header}
      <span role="status" className="sr-only">
        {t('loading')}
      </span>
      {children}
    </div>
  );
}

/** Вхід / реєстрація: «До трансляцій», картка форми; на десктопі (≥ 1024) ліворуч — «Навіщо акаунт». */
export function AuthSkeleton({ mode }: { mode: 'signin' | 'signup' }) {
  return (
    <Shell kind={mode === 'signup' ? 'signup' : 'login'} header={<HeaderSkeleton />}>
      <main className={st.authMain}>
        <span className={st.authBack}>
          <Bar w={110} h={16} />
        </span>
        <div className={st.authLayout}>
          <div className={st.authSide}>
            <Frame className={sk.fill} p={32}>
              <Bar raised w={220} h={30} />
              <Bar raised w={320} h={18} mt={16} />
              {[0, 1, 2].map((i) => (
                <Row key={i} mt={32} h={56} g={16}>
                  <Bar raised shape="btn" w={44} h={44} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Bar raised w={180} h={20} />
                    <Bar raised w={280} h={16} mt={8} />
                  </div>
                </Row>
              ))}
            </Frame>
          </div>
          <section className={st.authCard} aria-hidden="true">
            <Bar w={120} h={34} mt={[2, 2, 0]} />
            <Bar w={300} h={18} mt={12} />
            <Bar w={220} h={18} mt={6} />
            <Bar shape="btn" h={37} mt={20} />
            <Bar w={80} h={12} mt={20} className="mx-auto" />
            <Bar w={50} h={14} mt={20} />
            <Bar shape="btn" h={37} mt={8} />
            <Bar w={300} h={14} mt={10} />
            <Bar shape="btn" h={37} mt={14} />
            <Bar w={200} h={16} mt={30} className="mx-auto" />
            <Bar shape="card" h={168} mt={26} />
          </section>
        </div>
      </main>
    </Shell>
  );
}

/** Сторінка пасу: герой із квитком і ціною, картка оформлення (на десктопі — праворуч), «Що вмикається». */
export function PassSkeleton() {
  return (
    <Shell kind="pass" header={<HeaderSkeleton />}>
      <main className={st.passMain}>
        <Frame className={sk.passHero} p={[20, 20, 32]}>
          <div className={sk.passHeroIn}>
            <Bar raised shape="card" w={[292, 292, 300]} h={[140, 140, 150]} />
            <div className={sk.passHeroText}>
              <Bar raised w={210} h={34} />
              <Bar raised w={130} h={44} mt={8} />
              <Bar raised w={240} h={18} mt={10} />
              <Bar raised w={280} h={36} mt={8} />
            </div>
          </div>
        </Frame>
        <section className={st.passCard} aria-hidden="true">
          <Row h={24}>
            <Bar raised w={140} h={14} />
            <Grow />
            <Bar raised w={50} h={20} />
          </Row>
          <Bar raised w={220} h={24} mt={14} />
          <Bar raised shape="btn" h={37} mt={20} />
          <Bar raised w={80} h={12} mt={20} className="mx-auto" />
          <Bar raised w={50} h={14} mt={20} />
          <Bar raised shape="btn" h={37} mt={8} />
          <Bar raised w={240} h={14} mt={10} />
          <Bar raised shape="btn" h={44} mt={16} />
        </section>
        <div className={st.passPerks} aria-hidden="true">
          <Bar w={160} h={16} />
          <Bar w={[300, 420, 420]} h={[46, 30, 30]} mt={8} />
          <Bar w={[320, 420, 420]} h={20} mt={12} />
          <Bar shape="card" h={[400, 504, 504]} mt={20} />
        </div>
      </main>
    </Shell>
  );
}

/** Службові сторінки (умови, конфіденційність, оплата, cookies, правила чату, допомога): зміст, заголовок, розділи. */
export function LegalSkeleton() {
  return (
    <Shell kind="legal" header={<HeaderSkeleton />}>
      <main className={st.legalMain}>
        <span aria-hidden="true" className={st.legalBar}>
          <Bar raised w={41} h={18} />
          <Bar raised w={200} h={20} />
        </span>
        <div className={st.legalLayout}>
          <aside className={st.legalAside} aria-hidden="true">
            <Bar w={90} h={12} mt={6} />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Bar key={i} shape="btn" h={40} mt={i ? 4 : 10} />
            ))}
          </aside>
          <div className={st.legalBody} aria-hidden="true">
            <Bar w={[240, 360, 360]} h={[33, 44, 44]} />
            <Bar w={170} h={18} mt={8} />
            <Bar shape="card" h={[154, 82, 82]} mt={20} />
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Bar w={[220, 300, 300]} h={24} mt={32} />
                <Bar h={16} mt={14} />
                <Bar h={16} mt={8} />
                <Bar w="70%" h={16} mt={8} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </Shell>
  );
}

/** «Про нас»: заголовок, абзац, рядок «скоро», «Написати нам». */
export function AboutSkeleton() {
  return (
    <Shell kind="about" header={<HeaderSkeleton current="about" />}>
      <main className={st.aboutMain} aria-hidden="true">
        <Bar w={[150, 190, 190]} h={[35, 44, 44]} />
        <Grid cols={[1, 1, 1]} g={10} mt={20}>
          <Bar h={18} />
          <Bar h={18} />
          <Bar w="60%" h={18} />
        </Grid>
        <Bar w={[300, 520, 520]} h={20} mt={14} />
        <Bar w={130} h={22} mt={22} />
      </main>
    </Shell>
  );
}
