/** Тестова збірка: вмикає «машину часу». Константа, щоб код відсікався в робочій збірці. */
export const IS_TEST_BUILD = process.env.NEXT_PUBLIC_ENV === 'test';
/**
 * Демо для тесту на людях (рішення власника 2026-11-11): тестова збірка (`NEXT_PUBLIC_ENV=test`) плюс `NEXT_PUBLIC_DEMO=1` —
 * ніч стартує за 20 хв до півночі Парижа, гість уже зустрів 5 міст, трансляції — торішні записи, «Машина часу» в меню.
 */
export const IS_DEMO_BUILD = IS_TEST_BUILD && process.env.NEXT_PUBLIC_DEMO === '1';
