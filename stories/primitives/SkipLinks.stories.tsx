import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/SkipLinks', component: SkipLinks } satisfies Meta<typeof SkipLinks>;
export default meta;
type Story = StoryObj<typeof meta>;

const Page = ({ children }: { children: React.ReactNode }) => (
  <Stage>
    {children}
    <main id="main" tabIndex={-1} className="text-body">
      Вміст сторінки
    </main>
    <aside id="chat" aria-label="Чат" className="text-body">
      Чат
    </aside>
    <div id="map" className="text-body">
      Мапа
    </div>
  </Stage>
);

export const Focused: Story = {
  name: 'Видимі лише у фокусі: перший Tab показує «Перейти до вмісту»',
  render: () => (
    <Page>
      <SkipLinks />
    </Page>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

export const WithoutMap: Story = {
  name: 'Без мапи: лише ті цілі, що є на сторінці',
  render: () => (
    <Page>
      <SkipLinks targets={['content', 'chat']} />
    </Page>
  ),
  play: async () => {
    await userEvent.tab();
    await userEvent.tab();
  },
};
