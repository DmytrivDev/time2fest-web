import type { Preview } from '@storybook/nextjs';
import '../app/globals.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: { options: { dark: { name: 'dark', value: '#121214' } } },
    viewport: {
      options: {
        phone: { name: 'Телефон 390', styles: { width: '390px', height: '844px' } },
        desktop: { name: 'Десктоп 1440', styles: { width: '1440px', height: '900px' } },
        tv: { name: 'ТВ 1920', styles: { width: '1920px', height: '1080px' } },
      },
    },
  },
  initialGlobals: { backgrounds: { value: 'dark' } },
};

export default preview;
