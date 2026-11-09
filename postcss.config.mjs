/**
 * PostCSS: Tailwind, далі px → rem (рішення власника 2026-11-09, `scaling-concept-2026-11-09.md`).
 * Усі розміри в CSS стають `rem` під час збірки (16 px = 1 rem), щоб сайт масштабувався пропорційно від кегля кореня.
 * Лінії 1–1,5 px лишаються в px (не розмиваються); межі макетів (media queries) — у px, бо вони про ширину екрана.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    'postcss-pxtorem': {
      rootValue: 16,
      unitPrecision: 5,
      propList: ['*'],
      minPixelValue: 2,
      mediaQuery: false,
      replace: true,
    },
  },
};
export default config;
