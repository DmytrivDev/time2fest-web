/**
 * Скелетон головної «до свята» (`/before`, `loading.tsx`): як на інших сторінках сайту (`components/skeleton`) — без
 * `'use client'`, показується одразу. Банер (рядок дати, заголовок, опис, кнопки, відлік), панель розкладу з картками
 * і заголовок наступної секції; бруски стоять там, де стане вміст.
 */
import { useTranslations } from 'next-intl';
import { Bar, Frame, SkeletonRoot } from '@/components/skeleton/parts';
import { cn } from '@/components/primitives/cn';
import s from './prefest.module.css';
import k from './PrefestSkeleton.module.css';

export function PrefestSkeleton() {
  const t = useTranslations('prefest.meta');
  return (
    <SkeletonRoot kind="home-prefest" label={t('loading')} className={s.page}>
      <div className={k.hero}>
        <div className={cn(s.wrap, k.bar)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- статичний експорт; те саме зображення, що в шапці */}
          <img src="/brand/logo.png" alt="" width={112} height={32} className={k.logo} />
        </div>
        <div className={cn(s.wrap, k.heroGrid)}>
          <div>
            <Bar w={[220, 320, 340]} h={14} />
            <Bar w={[300, 520, 560]} h={[40, 56, 68]} mt={18} />
            <Bar w={[220, 380, 420]} h={[40, 56, 68]} mt={8} />
            <Bar w={[300, 480, 540]} h={18} mt={22} />
            <Bar w={[260, 420, 480]} h={18} mt={10} />
            <div className={k.row}>
              <Bar shape="btn" w={[170, 200, 200]} h={48} />
              <Bar shape="btn" w={[170, 190, 190]} h={48} />
            </div>
          </div>
          <div className={k.cd}>
            {[0, 1, 2, 3].map((i) => (
              <Frame key={i} w={[72, 92, 112]} h={[70, 100, 108]} />
            ))}
          </div>
        </div>
      </div>
      <div className={cn(s.wrap, k.sched)}>
        <Frame p={[16, 28, 28]}>
          <Bar w={[160, 260, 260]} h={26} raised />
          <div className={k.cards}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Bar key={i} shape="card" h={[260, 280, 280]} raised className={k.card} />
            ))}
          </div>
        </Frame>
      </div>
      <div className={cn(s.wrap, s.sec)}>
        <Bar w={[240, 420, 460]} h={[30, 38, 38]} />
        <Bar w={[300, 560, 600]} h={18} mt={14} />
      </div>
    </SkeletonRoot>
  );
}
