// Свято штампа в шапці (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header` v2, 2026-11-12): черга, відкладення,
// таймлайн із паузою, «Зменшити рух», вибір слів і підказка за хвилину до півночі.
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '@/messages/uk.json';
import {
  addStamps,
  CELEBRATION_MS,
  celebrationPhase,
  clockElapsed,
  createQueue,
  deskWords,
  FILL_MS,
  finishActive,
  FLIGHT_END_MS,
  hasPending,
  isLongName,
  nextBoundary,
  pauseClock,
  phoneWords,
  REDUCED_CELEBRATION_MS,
  resumeClock,
  setEnv,
  spokenText,
  stampHintActive,
  startClock,
  TEXT_END_MS,
  type Celebration,
  type CelebrationStamp,
  type Msg,
} from '@/lib/stamp/stampCelebration';
import { CATCH_UP_MAX_AGE_MS } from '@time2fest/rules/time';

const T0 = Date.parse('2026-12-31T23:00:15Z');
const FR: CelebrationStamp = { eventId: 'evt_paris', country: 'Франція', gender: 'f', flagCode: 'FR', grantedAt: T0 };
const DE: CelebrationStamp = { eventId: 'evt_berlin', country: 'Німеччина', gender: 'f', flagCode: 'DE', grantedAt: T0 };
const IT: CelebrationStamp = { eventId: 'evt_rome', country: 'Італія', gender: 'f', flagCode: 'IT', grantedAt: T0 };
const GB: CelebrationStamp = { eventId: 'evt_london', country: 'Велика Британія', gender: 'f', flagCode: 'GB', grantedAt: T0 + 3_600_000 };
const VC: CelebrationStamp = { eventId: 'evt_vc', country: 'Сент-Вінсент і Гренадини', gender: 'pl', flagCode: 'VC', grantedAt: T0 };

const t = createTranslator({ locale: 'uk', messages: messages as never, namespace: 'header.celebration' as never }) as unknown as (
  key: string,
  params?: Record<string, string | number>,
) => string;
const r = (m: Msg | undefined) => (m ? t(m.key, m.params) : '');
const desk = (c: Pick<Celebration, 'kind' | 'stamps'>, guest = false, short = false) => {
  const w = deskWords(c, { guest, short });
  return { lead: r(w.lead), main: r(w.main), tail: r(w.tail), see: r(w.see), check: w.check };
};
const phone = (c: Pick<Celebration, 'kind' | 'stamps'>, guest = false, short = false) => {
  const w = phoneWords(c, { guest, short });
  return [r(w.line1), r(w.line2)];
};

describe('черга свят', () => {
  it('один штамп — одне свято «зараз»; дограло — черга порожня, дзвіночок відпускає', () => {
    let q = addStamps(createQueue(), [FR], T0);
    expect(q.active).toMatchObject({ kind: 'now', stamps: [FR] });
    expect(hasPending(q)).toBe(true);
    q = finishActive(q);
    expect(q.active).toBeNull();
    expect(hasPending(q)).toBe(false);
  });

  it('кілька штампів одного моменту (кімната) — одне свято, не три поспіль; повтор події не дублюється', () => {
    const q = addStamps(createQueue(), [FR, DE, IT, FR], T0);
    expect(q.active?.stamps.map((s) => s.eventId)).toEqual(['evt_paris', 'evt_berlin', 'evt_rome']);
    expect(q.queue).toEqual([]);
  });

  it('новий штамп під час свята — наступне свято після поточного; кілька таких — зливаються в одне', () => {
    let q = addStamps(createQueue(), [FR], T0);
    q = addStamps(q, [DE], T0 + 1000);
    q = addStamps(q, [IT], T0 + 2000);
    expect(q.active?.stamps).toEqual([FR]);
    expect(q.queue).toHaveLength(1);
    expect(q.queue[0]!.stamps).toEqual([DE, IT]);
    q = finishActive(q);
    expect(q.active?.stamps).toEqual([DE, IT]);
  });

  it('повний екран: свята немає, штампи чекають; вийшли — одне свято «Під час перегляду» на всі', () => {
    let q = setEnv(createQueue(), { fullscreen: true, hidden: false }, T0 - 5000);
    q = addStamps(q, [FR], T0);
    q = addStamps(q, [GB], GB.grantedAt);
    expect(q.active).toBeNull();
    expect(q.deferred).toHaveLength(2);
    expect(hasPending(q)).toBe(true);
    q = setEnv(q, { fullscreen: false, hidden: false }, GB.grantedAt + 60_000);
    // Франція старша за 30 хв — випадає; Велика Британія — свято.
    expect(q.active).toMatchObject({ kind: 'fullscreen', stamps: [GB] });
    expect(q.deferred).toEqual([]);
  });

  it('прихована вкладка: повернулись — «Поки тебе не було»; повний екран і вкладка разом — свято лише коли минуло обидва', () => {
    let q = setEnv(createQueue(), { fullscreen: true, hidden: true }, T0);
    q = addStamps(q, [FR, DE], T0);
    q = setEnv(q, { fullscreen: true, hidden: false }, T0 + 1000);
    expect(q.active).toBeNull();
    q = setEnv(q, { fullscreen: false, hidden: false }, T0 + 2000);
    expect(q.active).toMatchObject({ kind: 'fullscreen', stamps: [FR, DE] });

    let q2 = setEnv(createQueue(), { fullscreen: false, hidden: true }, T0);
    q2 = addStamps(q2, [FR], T0);
    q2 = setEnv(q2, { fullscreen: false, hidden: false }, T0 + 10 * 60_000);
    expect(q2.active).toMatchObject({ kind: 'tab', stamps: [FR] });
  });

  it('штамп прийшов одразу після повернення на вкладку (такт проспав північ) — «Поки тебе не було»', () => {
    const q = addStamps(createQueue(), [FR], T0 + 5 * 60_000, { returning: true });
    expect(q.active?.kind).toBe('tab');
  });

  it('старший за 30 хв — без свята (лише +1 на дзвіночку): і одразу, і після повернення', () => {
    expect(addStamps(createQueue(), [FR], T0 + CATCH_UP_MAX_AGE_MS + 1)).toEqual(createQueue());
    let q = setEnv(createQueue(), { fullscreen: false, hidden: true }, T0);
    q = addStamps(q, [FR], T0);
    q = setEnv(q, { fullscreen: false, hidden: false }, T0 + CATCH_UP_MAX_AGE_MS + 1);
    expect(q.active).toBeNull();
    expect(hasPending(q)).toBe(false);
    // Рівно 30 хв — ще свято.
    let q3 = setEnv(createQueue(), { fullscreen: false, hidden: true }, T0);
    q3 = addStamps(q3, [FR], T0);
    q3 = setEnv(q3, { fullscreen: false, hidden: false }, T0 + CATCH_UP_MAX_AGE_MS);
    expect(q3.active?.kind).toBe('tab');
  });
});

describe('таймлайн', () => {
  it('0–0,4 с заливка · до 8 с текст · 8–9,2 с політ · до 10 с повернення · далі кінець', () => {
    expect(celebrationPhase(0, false)).toBe('fill');
    expect(celebrationPhase(FILL_MS, false)).toBe('show');
    expect(celebrationPhase(TEXT_END_MS - 1, false)).toBe('show');
    expect(celebrationPhase(TEXT_END_MS, false)).toBe('fly');
    expect(celebrationPhase(FLIGHT_END_MS, false)).toBe('settle');
    expect(celebrationPhase(CELEBRATION_MS, false)).toBe('done');
    expect([FILL_MS, TEXT_END_MS, FLIGHT_END_MS, CELEBRATION_MS]).toEqual([400, 8000, 9200, 10_000]);
    expect(nextBoundary(0, false)).toBe(400);
    expect(nextBoundary(5000, false)).toBe(3000);
    expect(nextBoundary(CELEBRATION_MS, false)).toBeNull();
  });

  it('«Зменшити рух»: одразу золото (без заливки й польоту), 9 с — і одразу звичайна шапка', () => {
    expect(celebrationPhase(0, true)).toBe('show');
    expect(celebrationPhase(8_500, true)).toBe('show');
    expect(celebrationPhase(REDUCED_CELEBRATION_MS, true)).toBe('done');
    expect(REDUCED_CELEBRATION_MS).toBe(9000);
    expect(nextBoundary(0, true)).toBe(9000);
  });

  it('наведення чи фокус — пауза (WCAG 2.2.1): час стоїть, після паузи йде далі', () => {
    let c = startClock(1000);
    expect(clockElapsed(c, 4000)).toBe(3000);
    c = pauseClock(c, 4000);
    expect(clockElapsed(c, 60_000)).toBe(3000);
    expect(celebrationPhase(clockElapsed(c, 60_000), false)).toBe('show');
    c = resumeClock(c, 60_000);
    expect(clockElapsed(c, 65_000)).toBe(8000);
    // Повторні пауза/продовження нічого не ламають.
    expect(pauseClock(pauseClock(c, 66_000), 70_000)).toEqual(pauseClock(c, 66_000));
    expect(resumeClock(c, 99_000)).toBe(c);
  });
});

describe('слова', () => {
  it('десктоп, один штамп: «З Новим роком, Франція!» · ✓ «Штамп у паспорті» · «Подивитися штамп»', () => {
    expect(desk({ kind: 'now', stamps: [FR] })).toEqual({ lead: '', main: 'З Новим роком, Франція!', tail: 'Штамп у паспорті', see: 'Подивитися штамп', check: true });
  });

  it('гість: «Штамп на цьому пристрої»', () => {
    expect(desk({ kind: 'now', stamps: [FR] }, true).tail).toBe('Штамп на цьому пристрої');
    expect(phone({ kind: 'now', stamps: [FR] }, true)).toEqual(['З Новим роком, Франція!', 'Штамп на цьому пристрої']);
    expect(phone({ kind: 'fullscreen', stamps: [FR] }, true)[1]).toBe('Під час перегляду · штамп на цьому пристрої');
  });

  it('довга назва: десктоп понад 40 знаків чи не влазить — «З Новим роком!» і «Штамп у паспорті: …»; телефон — «… · штамп у паспорті»', () => {
    expect(isLongName('Сент-Вінсент і Гренадини', 'desk')).toBe(false);
    expect(isLongName('Сент-Вінсент і Гренадини', 'phone')).toBe(true);
    expect(isLongName('Франція', 'phone')).toBe(false);
    expect(desk({ kind: 'now', stamps: [VC] })).toMatchObject({ main: 'З Новим роком, Сент-Вінсент і Гренадини!' });
    expect(desk({ kind: 'now', stamps: [VC] }, false, true)).toMatchObject({ main: 'З Новим роком!', tail: 'Штамп у паспорті: Сент-Вінсент і Гренадини' });
    expect(phone({ kind: 'now', stamps: [VC] }, false, true)).toEqual(['З Новим роком!', 'Сент-Вінсент і Гренадини · штамп у паспорті']);
    expect(phone({ kind: 'now', stamps: [VC] }, true, true)).toEqual(['З Новим роком!', 'Сент-Вінсент і Гренадини · штамп на цьому пристрої']);
  });

  it('кілька разом: «З Новим роком!» · «3 нові штампи — Франція, Німеччина, Італія» · «Подивитися штампи»', () => {
    expect(desk({ kind: 'now', stamps: [FR, DE, IT] })).toMatchObject({
      main: 'З Новим роком!',
      tail: '3 нові штампи — Франція, Німеччина, Італія',
      see: 'Подивитися штампи',
      check: false,
    });
    expect(phone({ kind: 'now', stamps: [FR, DE, IT] })).toEqual(['З Новим роком!', '3 нові штампи — Франція, Німеччина, Італія']);
  });

  it('після повного екрана: «Під час перегляду:» · «Франція зустріла Новий рік» · «штамп у паспорті» (рід країни)', () => {
    expect(desk({ kind: 'fullscreen', stamps: [FR] })).toMatchObject({ lead: 'Під час перегляду:', main: 'Франція зустріла Новий рік', tail: 'штамп у паспорті' });
    expect(desk({ kind: 'fullscreen', stamps: [{ ...FR, country: 'Китай', gender: 'm' }] }).main).toBe('Китай зустрів Новий рік');
    expect(desk({ kind: 'fullscreen', stamps: [VC] }).main).toBe('Сент-Вінсент і Гренадини зустріли Новий рік');
    expect(phone({ kind: 'fullscreen', stamps: [FR] })).toEqual(['Франція зустріла Новий рік', 'Під час перегляду · штамп у паспорті']);
  });

  it('після повного екрана, 2+: «2 нові штампи» · «Франція, Велика Британія»; телефон — «2 нові штампи в паспорті»', () => {
    expect(desk({ kind: 'fullscreen', stamps: [FR, GB] })).toMatchObject({ lead: 'Під час перегляду:', main: '2 нові штампи', tail: 'Франція, Велика Британія', see: 'Подивитися штампи' });
    expect(phone({ kind: 'fullscreen', stamps: [FR, GB] })).toEqual(['2 нові штампи в паспорті', 'Франція, Велика Британія']);
    const five = [FR, DE, IT, GB, VC];
    expect(desk({ kind: 'fullscreen', stamps: five }).main).toBe('5 нових штампів');
  });

  it('повернення на вкладку: «Поки тебе не було: …»', () => {
    expect(desk({ kind: 'tab', stamps: [FR] })).toMatchObject({ lead: 'Поки тебе не було:', main: 'Франція зустріла Новий рік' });
    expect(phone({ kind: 'tab', stamps: [FR] })).toEqual(['Франція зустріла Новий рік', 'Поки тебе не було · штамп у паспорті']);
  });

  it('читач екрана — один рядок без слова «ачівка»', () => {
    expect(spokenText({ kind: 'now', stamps: [FR] }, false, t)).toBe('З Новим роком, Франція! Штамп у паспорті');
    expect(spokenText({ kind: 'now', stamps: [FR] }, true, t)).toBe('З Новим роком, Франція! Штамп на цьому пристрої');
    expect(spokenText({ kind: 'fullscreen', stamps: [FR] }, false, t)).toBe('Під час перегляду: Франція зустріла Новий рік · штамп у паспорті');
    expect(spokenText({ kind: 'fullscreen', stamps: [FR, GB] }, false, t)).toBe('Під час перегляду: 2 нові штампи — Франція, Велика Британія');
    expect(spokenText({ kind: 'now', stamps: [FR, DE, IT] }, false, t)).toBe('З Новим роком! 3 нові штампи — Франція, Німеччина, Італія');
    expect(JSON.stringify(messages)).not.toMatch(/[Аа]чівк/);
  });
});

describe('підказка за хвилину до півночі', () => {
  it('лише останні 60 с і лише без штампа; опівночі зникає', () => {
    expect(stampHintActive(61_000, false)).toBe(false);
    expect(stampHintActive(60_000, false)).toBe(true);
    expect(stampHintActive(1, false)).toBe(true);
    expect(stampHintActive(0, false)).toBe(false);
    expect(stampHintActive(30_000, true)).toBe(false);
  });
});
