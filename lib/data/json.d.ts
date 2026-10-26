// Резервне оголошення для `@/data/*.json`: використовується TypeScript лише тоді,
// коли файл ще не згенеровано (скрипти даних працюють паралельно). Якщо файл існує,
// діє його власний тип; `load.ts` однаково приводить його до типів із `types.ts`.
declare module '@/data/*.json' {
  const value: unknown;
  export default value;
}
