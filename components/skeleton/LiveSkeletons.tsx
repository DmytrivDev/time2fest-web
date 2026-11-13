/**
 * Скелетони сторінок макета `(live)` (правка власника 2026-11-10): кожна сторінка — свій скелетон, що повторює її стартову
 * розкладку (один найчастіший варіант) на телефоні, планшеті-портреті й ширше (там чат праворуч дає макет). Той самий
 * скелетон — і в `loading.tsx` сегмента (клієнтський перехід), і за адресою в `app/(live)/loading.tsx` (`LiveLoading`).
 * Шапку й колонку чату дає макет; згорнутий чат унизу (телефон, планшет-портрет) — тут, на місці `ChatDock`.
 * Розміри — з завантажених сторінок (390×844, 834×1194, 1024×768, 1520×900), щоб блоки не стрибали при заміні.
 */
import { useTranslations } from 'next-intl';
import sk from './skeleton.module.css';
import { Bar, Frame, Grid, Grow, Inset, Only, PlayerBar, Row, SkeletonRoot, TitleBars, FloatBar } from './parts';

/** Рядок під відео (телефон і планшет-портрет): звук, місто й відлік, «Наживо». */
function StickyBar({ badge = true }: { badge?: boolean }) {
  return (
    <Only on="not-wide">
      <Row inset="bar" h={[48, 60]} g={12}>
        <Bar shape="btn" w={44} h={44} />
        <Bar w={[180, 300]} h={[20, 24]} />
        <Grow />
        <Only on="tp">
          <Bar w={189} h={20} />
        </Only>
        {badge ? <Bar shape="pill" w={73} h={22} /> : null}
      </Row>
    </Only>
  );
}

/** Підпис під відео: назва трансляції, рядок країни, дії. `remote` — сторінка країни (без «Обрати трансляцію» на телефоні). */
function Caption({ timer, remote }: { timer?: boolean; remote?: boolean }) {
  return (
    <Inset>
      <Only on="wide">
        <Bar w={260} h={20} mt={16} />
        <Row mt={6} h={50}>
          <div className="flex min-w-0 flex-1 flex-col">
            <Bar w={280} h={28} />
            <Bar w={340} h={18} mt={4} />
          </div>
          {timer ? <Bar shape="btn" w={212} h={36} /> : <Bar w={131} h={22} />}
        </Row>
        <Row mt={16} h={44}>
          <Bar shape="btn" w={184} h={44} />
          {remote ? null : <Bar shape="btn" w={210} h={44} />}
          <Grow />
          <Only on="desk">
            <Bar shape="btn" w={205} h={44} />
            <Bar shape="btn" w={172} h={44} />
          </Only>
          <Bar shape="pill" w={44} h={44} />
        </Row>
      </Only>
      <Only on="not-wide">
        <Bar w={[220, 320]} h={[27, 35]} mt={[18, 28]} />
        <Bar w={[260, 420]} h={[20, 21]} mt={6} />
        <Row mt={[10, 6]} h={44}>
          {remote ? null : <Bar shape="btn" w={[184, 210]} h={44} />}
          <Grow />
          <Bar shape="pill" w={44} h={44} />
        </Row>
      </Only>
    </Inset>
  );
}

/** «Зараз і далі»: заголовок, фільтр, картки подій. */
function NowNext({ mt }: { mt: readonly [number, number?, number?] }) {
  return (
    <Inset>
      <Bar w={[140, 160, 160]} h={22} mt={mt} />
      <Bar w={[150, 170, 170]} h={14} mt={6} />
      <Only on="phone">
        <Bar shape="pill" h={46} mt={12} />
      </Only>
      <Grid cols={[1, 3, 2]} g={12} mt={[10, 16, 16]}>
        <Bar shape="card" h={[86, 275, 120]} />
        <Bar shape="card" h={[86, 275, 120]} />
        <Bar shape="card" h={[86, 275, 120]} />
        <Bar shape="card" h={[86, 275, 120]} />
      </Grid>
    </Inset>
  );
}

/** Головна (ефір): плеєр, рядок під відео, підпис і дії, «Зараз і далі» («Перший ряд» прибрано 2026-11-12). */
export function HomeSkeleton() {
  const t = useTranslations('states');
  return (
    <SkeletonRoot kind="home" label={t('loadingStream')} dock>
      <PlayerBar />
      <StickyBar />
      <Caption timer />
      <Only on="phone">
        <Inset>
          <Bar w={180} h={16} mt={18} />
        </Inset>
      </Only>
      <NowNext mt={[22, 22, 24]} />
    </SkeletonRoot>
  );
}

/** Сторінка країни: рядок країни (прапор, назва, північ), плеєр, підпис і дії, «Зараз і далі». */
export function CountrySkeleton() {
  const t = useTranslations('states');
  return (
    <SkeletonRoot kind="country" label={t('loadingStream')} dock>
      <Only on="not-wide">
        <Row inset="page" h={[60, 64]} g={12}>
          <Bar shape="pill" w={[28, 36]} h={[28, 36]} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Bar w={[90, 120]} h={[22, 26]} />
            <Bar w={[200, 280]} h={14} mt={4} />
          </div>
          <Bar shape="pill" w={[36, 40]} h={[36, 40]} />
        </Row>
      </Only>
      <Only on="wide">
        <Row h={60} g={16}>
          <Bar shape="pill" w={40} h={40} />
          <Bar w={120} h={30} />
          <Bar w={230} h={18} />
          <Grow />
          <Bar shape="btn" w={178} h={44} />
        </Row>
      </Only>
      <PlayerBar />
      <StickyBar badge={false} />
      <Caption remote />
      <Only on="phone">
        <Inset>
          <Bar w={180} h={16} mt={16} />
        </Inset>
      </Only>
      <NowNext mt={[40, 56, 56]} />
    </SkeletonRoot>
  );
}

/** Кімната перегляду: вікна (телефон — одне, ширше — 2×2), підпис, дії, поточні трансляції («Перший ряд» прибрано 2026-11-12). */
export function RoomSkeleton() {
  const t = useTranslations('states');
  return (
    <SkeletonRoot kind="room" label={t('loadingStream')} dock>
      <Only on="phone">
        <Bar shape="card" h={265} mt={16} className="rounded-none" />
        <Inset>
          <Bar w={90} h={14} mt={12} />
          <Row mt={11} h={44}>
            <Bar shape="btn" w={80} h={44} />
            <Grow />
            <Bar shape="pill" w={44} h={44} />
            <Bar shape="pill" w={44} h={44} />
            <Bar shape="pill" w={44} h={44} />
          </Row>
          <Bar w={190} h={22} mt={72} />
        </Inset>
      </Only>
      <Only on="not-phone">
        <div className={sk.roomPad}>
          <Grid cols={[1, 2, 2]} g={12}>
            <Bar shape="card" h={[265, 240, 326]} />
            <Bar shape="card" h={[265, 240, 326]} />
            <Bar shape="card" h={[265, 240, 326]} />
            <Bar shape="card" h={[265, 240, 326]} />
          </Grid>
          <Bar w={200} h={23} mt={16} />
          <Bar w={340} h={18} mt={10} />
          <Row mt={14} h={44}>
            <Bar shape="btn" w={222} h={44} />
            <Bar shape="btn" w={158} h={44} />
            <Grow />
            <Bar shape="btn" w={183} h={44} />
            <Bar shape="pill" w={44} h={44} />
          </Row>
          <Bar w={190} h={22} mt={[72, 104, 104]} />
        </div>
      </Only>
    </SkeletonRoot>
  );
}

/** «Мій графік»: заголовок, картка шляху з мапою, «Попереду» — рядки поясів. */
export function ScheduleSkeleton() {
  const t = useTranslations('common');
  return (
    <SkeletonRoot kind="schedule" label={t('loading')} pad dock>
      <TitleBars w={[150, 190, 190]} sub={[260, 420, 420]} />
      <Frame h={[396, 457, 581]} mt={[20, 24, 24]} p={[15, 21, 21]}>
        <Row h={[30, 30, 30]}>
          <Bar raised w={110} h={22} />
          <Grow />
          <Bar raised w={70} h={18} />
        </Row>
        <Only on="phone">
          <Bar raised w={180} h={14} mt={6} />
        </Only>
        <Bar raised shape="card" h={[303, 384, 497]} mt={[10, 12, 12]} />
      </Frame>
      <Bar w={[150, 170, 170]} h={[27, 30, 30]} mt={[20, 24, 24]} />
      {Array.from({ length: 6 }, (_, i) => (
        <Bar key={i} shape="card" h={[40, 48, 48]} mt={[8, 8, 8]} />
      ))}
    </SkeletonRoot>
  );
}

/** «Мій паспорт»: заголовок, картка «хто я» з плитками, мапа шляху. */
export function PassportSkeleton() {
  const t = useTranslations('common');
  return (
    <SkeletonRoot kind="passport" label={t('loading')} pad dock>
      <TitleBars w={[240, 360, 380]} sub={[320, 520, 560]} subH={[39, 23, 23]} />
      <Frame h={[310, 221, 221]} mt={[16, 24, 24]} p={[15, 21, 21]}>
        <Row h={[91, 75, 75]} g={12}>
          <Bar raised shape="pill" w={[36, 44, 44]} h={[36, 44, 44]} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Bar raised w={70} h={22} />
            <Bar raised w={[200, 260, 260]} h={14} mt={6} />
            <Bar raised w={[220, 320, 320]} h={14} mt={6} />
          </div>
        </Row>
        <Grid cols={[2, 4, 4]} g={12} mt={16}>
          <Bar raised shape="card" h={[80, 88, 88]} />
          <Bar raised shape="card" h={[80, 88, 88]} />
          <Bar raised shape="card" h={[80, 88, 88]} />
          <Bar raised shape="card" h={[80, 88, 88]} />
        </Grid>
      </Frame>
      <Frame h={[396, 457, 581]} mt={[15, 24, 24]} p={[15, 21, 21]}>
        <Bar raised w={160} h={22} />
        <Bar raised w={140} h={14} mt={8} />
        <Bar raised shape="card" h={[303, 384, 497]} mt={12} />
      </Frame>
      <Bar w={[120, 160, 160]} h={[27, 30, 30]} mt={[16, 24, 24]} />
      <Bar shape="card" h={[300, 340, 340]} mt={16} />
    </SkeletonRoot>
  );
}

/** «Рейтинг святкувань»: заголовок, картка відліку, «Усі святкування» — рядки. */
export function RatingSkeleton() {
  const t = useTranslations('common');
  return (
    <SkeletonRoot kind="rating" label={t('loading')} pad dock>
      <TitleBars w={[220, 300, 300]} sub={[320, 520, 560]} subH={[39, 23, 23]} />
      <Frame h={[190, 97, 97]} mt={[18, 24, 24]} p={[15, 21, 21]}>
        <Row h={[89, 55, 55]} g={14}>
          <Bar raised shape="pill" w={44} h={44} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Bar raised w={[240, 420, 420]} h={18} />
            <Bar raised w={[200, 300, 300]} h={14} mt={8} />
          </div>
        </Row>
        <Only on="phone">
          <Bar raised w={140} h={30} mt={14} />
        </Only>
      </Frame>
      <Bar w={[160, 180, 180]} h={[22, 27, 27]} mt={[18, 24, 24]} />
      <Bar shape="pill" w={[100, 110, 110]} h={[30, 34, 34]} mt={[14, 10, 10]} />
      {Array.from({ length: 6 }, (_, i) => (
        <Bar key={i} shape="card" h={[68, 64, 64]} mt={[10, 8, 8]} />
      ))}
    </SkeletonRoot>
  );
}

/**
 * «Тости світу» (2026-11-13; перший екран під час свята): героїчний блок — ярлик, заголовок, підзаголовок, лічильники й
 * «Сказати тост» (телефон — без ілюстрації); нижче — список тостів.
 */
export function SupportSkeleton() {
  const t = useTranslations('common');
  return (
    <SkeletonRoot kind="support" label={t('loading')} pad dock>
      <Frame h={[293, 309, 285]} p={[19, 29, 29]}>
        <Only on="phone">
          <Bar raised w={100} h={14} />
          <Bar raised w={200} h={32} mt={10} />
          <Bar raised w={300} h={62} mt={12} />
          <Bar raised w={240} h={40} mt={12} />
          <Bar raised shape="btn" h={48} mt={18} />
        </Only>
        <Only on="not-phone">
          <Row h={[250, 250, 226]} g={40}>
            <Bar raised shape="card" w={300} h={170} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Bar raised w={110} h={14} />
              <Bar raised w={300} h={40} mt={12} />
              <Bar raised w={420} h={42} mt={12} />
              <Bar raised w={300} h={18} mt={14} />
              <Bar raised shape="btn" w={220} h={48} mt={18} />
            </div>
          </Row>
        </Only>
      </Frame>
      <Frame h={[559, 520, 520]} mt={[16, 24, 24]} p={[17, 21, 21]}>
        <Bar raised w={220} h={14} />
        <Bar raised shape="card" h={76} mt={12} />
        <Bar raised shape="card" h={76} mt={10} />
        <Bar raised w={180} h={24} mt={18} />
        <Bar raised shape="card" h={56} mt={12} />
        <Bar raised shape="card" h={56} mt={10} />
      </Frame>
    </SkeletonRoot>
  );
}

/** Кабінет: заголовок, підзаголовок, картка «Профіль». */
export function AccountSkeleton() {
  const t = useTranslations('common');
  return (
    <SkeletonRoot kind="account" label={t('loading')} pad>
      <Bar w={[120, 150, 150]} h={[33, 40, 40]} />
      <Bar w={[320, 420, 420]} h={23} mt={6} />
      <Frame h={[1105, 820, 820]} mt={[24, 23, 23]} p={[17, 25, 25]}>
        <Bar raised w={100} h={24} />
        <Bar raised w={[260, 360, 360]} h={16} mt={8} />
        <Row mt={24} h={64} g={16}>
          <Bar raised shape="pill" w={64} h={64} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Bar raised w={140} h={20} />
            <Bar raised w={200} h={14} mt={8} />
          </div>
        </Row>
        <Bar raised w={60} h={14} mt={24} />
        <Bar raised shape="btn" h={48} mt={8} />
        <Bar raised w={80} h={14} mt={20} />
        <Bar raised shape="btn" h={48} mt={8} />
      </Frame>
      <Only on="not-wide">
        <FloatBar />
      </Only>
    </SkeletonRoot>
  );
}

/** «Режим вечірки — як увімкнути»: мітка, заголовок, опис, макет екрана, переваги, кроки. */
export function TvInfoSkeleton() {
  const t = useTranslations('common');
  return (
    <SkeletonRoot kind="tv-info" label={t('loading')} pad dock>
      <Only on="phone">
        <Bar w={110} h={14} />
        <Bar w={300} h={52} mt={10} />
        <Bar w={340} h={62} mt={12} />
        <Bar shape="card" h={116} mt={12} />
        <Bar w={300} h={18} mt={20} />
        <Bar w={280} h={18} mt={8} />
        <Bar w={300} h={18} mt={8} />
        <Bar w={260} h={18} mt={8} />
        <Bar w={140} h={24} mt={30} />
        <Bar shape="card" h={74} mt={14} />
        <Bar shape="card" h={74} mt={8} />
        <Bar shape="card" h={74} mt={8} />
        <Bar shape="card" h={171} mt={52} />
      </Only>
      <Only on="not-phone">
        <Frame h={[365, 470, 365]} p={[28, 28, 28]}>
          <Row h={[309, 414, 309]} g={32}>
            <div className="flex min-w-0 flex-1 flex-col">
              <Bar raised w={120} h={14} />
              <Bar raised w={360} h={80} mt={12} />
              <Bar raised w={400} h={44} mt={16} />
              <Row mt={24} h={44}>
                <Bar raised shape="btn" w={170} h={44} />
                <Bar raised shape="btn" w={140} h={44} />
              </Row>
            </div>
            <Bar raised shape="card" w={[300, 300, 380]} h={240} />
          </Row>
        </Frame>
        <Grid cols={[2, 2, 2]} g={12} mt={20}>
          <Bar h={20} />
          <Bar h={20} />
          <Bar h={20} />
          <Bar h={20} />
        </Grid>
        <Bar w={180} h={36} mt={40} />
        <Grid cols={[3, 3, 3]} g={12} mt={14}>
          <Bar shape="card" h={214} />
          <Bar shape="card" h={214} />
          <Bar shape="card" h={214} />
        </Grid>
        <Bar shape="card" h={94} mt={28} />
      </Only>
    </SkeletonRoot>
  );
}

/** Скелетон за адресою (`app/(live)/loading.tsx` — якщо межа групи спрацювала раніше за межу сегмента). */
export function liveSkeletonFor(path: string): 'home' | 'country' | 'room' | 'schedule' | 'passport' | 'rating' | 'support' | 'account' | 'tv-info' | 'countries' {
  const p = path.replace(/\/+$/, '');
  if (p.startsWith('/country/')) return 'country';
  if (p === '/countries') return 'countries';
  if (p === '/room') return 'room';
  if (p === '/schedule') return 'schedule';
  if (p === '/passport') return 'passport';
  if (p === '/rating') return 'rating';
  if (p === '/support') return 'support';
  if (p === '/account') return 'account';
  if (p === '/tv-info') return 'tv-info';
  return 'home';
}
