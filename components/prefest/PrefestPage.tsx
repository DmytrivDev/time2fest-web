'use client';

/**
 * Головна «до свята» (`/before`, дизайн v3, погоджено власником 2026-11-17). Сторінка без плеєра, чату, входу й оплат:
 * банер з відліком, розклад, «Коли Новий рік прийде до тебе?», мапа, «Пройдися святом», «Що таке Time2Fest», традиції,
 * пас (без продажу), «Коротко про головне», підвал. Дані — лише `web/data` (`lib/prefest/model`); час — за годинником
 * відвідувача (`createDeviceTimeSource`), навіть у демо-збірці, де решта сайту живе на віртуальній ночі свята.
 */
import { useMemo, useState } from 'react';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { getData } from '@/lib/data/load';
import { buildPrefestModel } from '@/lib/prefest/model';
import { createDeviceTimeSource } from '@/lib/time/deviceTimeSource';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { CountryCards } from './CountryCards';
import { MyMidnight } from './MyMidnight';
import { NightWalk } from './NightWalk';
import { PassBlock } from './PassBlock';
import { PrefestFaq } from './PrefestFaq';
import { PrefestFooter } from './PrefestFooter';
import { PrefestHeader } from './PrefestHeader';
import { PrefestHero } from './PrefestHero';
import { PrefestMap } from './PrefestMap';
import { PrefestProvider } from './PrefestContext';
import { ScheduleRail } from './ScheduleRail';
import { WhatIs } from './WhatIs';
import s from './prefest.module.css';

export function PrefestPage() {
  const [source] = useState(createDeviceTimeSource);
  const model = useMemo(() => buildPrefestModel(getData()), []);
  return (
    <TimeProvider source={source}>
      <PrefestProvider model={model}>
        <div className={s.page} data-page="S-HOME-PREFEST">
          <SkipLinks targets={['content']} />
          <PrefestHeader />
          <main id="content" tabIndex={-1} className="focus:outline-none">
            <PrefestHero />
            <ScheduleRail />
            <MyMidnight />
            <PrefestMap />
            <NightWalk />
            <WhatIs />
            <CountryCards />
            <PassBlock />
            <PrefestFaq />
          </main>
          <PrefestFooter />
        </div>
      </PrefestProvider>
    </TimeProvider>
  );
}
