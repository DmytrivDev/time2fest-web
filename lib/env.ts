/** Тестова збірка: вмикає «машину часу». Константа, щоб код відсікався в робочій збірці. */
export const IS_TEST_BUILD = process.env.NEXT_PUBLIC_ENV === 'test';
