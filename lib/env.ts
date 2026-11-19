/** Тестова збірка: вмикає «машину часу». Константа, щоб код відсікався в робочій збірці. */
export const IS_TEST_BUILD = process.env.NEXT_PUBLIC_ENV === 'test';
/**
 * Демо для тесту на людях (рішення власника 2026-11-11): тестова збірка (`NEXT_PUBLIC_ENV=test`) плюс `NEXT_PUBLIC_DEMO=1` —
 * ніч стартує за 20 хв до півночі Парижа, гість уже зустрів 5 міст, трансляції — торішні записи, «Машина часу» в меню.
 */
export const IS_DEMO_BUILD = IS_TEST_BUILD && process.env.NEXT_PUBLIC_DEMO === '1';
/**
 * Збірка класу `rehearsal` (SPEC-07, AC-58): збирається як test + http, але без машини часу й без `/api/_test/*` —
 * час іде від сервера (`TimeSource`).
 */
export const IS_REHEARSAL_BUILD = process.env.NEXT_PUBLIC_SITE_CLASS === 'rehearsal';
/** Машина часу є: тестова збірка, крім репетиції. */
export const HAS_TIME_MACHINE = process.env.NEXT_PUBLIC_ENV === 'test' && process.env.NEXT_PUBLIC_SITE_CLASS !== 'rehearsal';
/** Інтеграційна збірка (test + http): машина часу — на тестовому годиннику сервера (AC-59…AC-61). */
export const SERVER_TIME_MACHINE =
  process.env.NEXT_PUBLIC_ENV === 'test' && process.env.NEXT_PUBLIC_SITE_CLASS !== 'rehearsal' && process.env.NEXT_PUBLIC_API_MODE === 'http';
