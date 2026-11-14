import type { Meta, StoryObj } from '@storybook/nextjs';
import { AuthorPanel } from '@/components/chat/parts/AuthorPanel';
import { PathLegend, PathMap } from '@/components/map/PathMap';
import chatScript from '@/data/chat-script.json';
import { buildAuthorPath } from '@/lib/chat/authorPath';
import { getData } from '@/lib/data/load';
import type { Author, ChatMessage, ChatScriptFile } from '@/lib/data/types';
import { Stage } from '../_support/Stage';

const script = chatScript as unknown as ChatScriptFile;
const KARIM: Author = { id: 'u_karim', nick: 'Karim', flagCode: 'EG', badges: ['pass'] };
const BOHDAN: Author = { id: 'u_bohdan', nick: 'Богдан', flagCode: 'UA', badges: ['pass'] };
const AMIRA: Author = { id: 'u_amira', nick: 'Аміра', flagCode: 'CA', badges: ['pass'] };
const TARAS: Author = { id: 'u_taras', nick: 'Тарас', flagCode: 'UA', badges: [] };
const ME: Author = { id: 'me', nick: 'Мирон', flagCode: 'UA', badges: [], isMine: true };

const message = (author: Author, text: string): ChatMessage => ({
  id: 'm1',
  room: 'world',
  kind: 'regular',
  createdAt: Date.parse('2027-01-01T01:37:00Z'),
  author,
  text,
  moderation: 'ok',
  reactions: { clap: { count: 2, mine: false } },
});

const meta = {
  title: 'Живий ефір/AuthorPanel',
  component: AuthorPanel,
  globals: { surface: 'phone' },
  args: {
    author: KARIM,
    countryName: 'Єгипет',
    message: message(KARIM, '@Аміра Привіт з Каїра! У нас уже 2027 🎆'),
    hasPass: true,
    path: buildAuthorPath(KARIM, script, getData()),
    viewerHasPass: false,
    onReport: () => undefined,
    onPassInfo: () => undefined,
  },
  render: (args) => (
    <Stage>
      <div className="flex h-160 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <AuthorPanel {...args} />
      </div>
    </Stage>
  ),
} satisfies Meta<typeof AuthorPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PhoneAuthor: Story = { name: 'Phone-Author — шлях Karim: зустрінуті жовті, заплановані порожні' };

export const DeskAuthor: Story = { name: 'Desk-Author', globals: { surface: 'desktop' } };

export const PassNothingMetScheduled: Story = {
  name: 'Phone-Author-States — пас, зустрічей ще нема, є графік',
  args: { author: BOHDAN, countryName: 'Україна', message: message(BOHDAN, 'Хто ще тут із нашого міста?'), path: buildAuthorPath(BOHDAN, script, getData()) },
};

export const PassNothingAtAll: Story = {
  name: 'Phone-Author-States — пас, зустрічей і графіка нема',
  args: { author: AMIRA, countryName: 'Канада', message: message(AMIRA, 'Привіт з Торонто!'), path: [] },
};

export const NoPass: Story = {
  name: 'Phone-Author-NoPass — без пасу: мапа затемнена, картки шляху нема',
  args: { author: TARAS, countryName: 'Україна', message: message(TARAS, 'У нас уже святкують'), hasPass: false, path: [] },
};

export const ViewerWithPass: Story = { name: 'глядач з пасом — без плашки «Оформи пас»', args: { viewerHasPass: true } };

export const Mine: Story = { name: 'свій нік — «це ти», дій над собою немає', args: { author: ME, message: message(ME, 'Вітаю з Києва!'), countryName: 'Україна', hasPass: false, path: [] } };

export const Map: Story = {
  name: 'PathMap окремо + легенда',
  render: (args) => (
    <Stage>
      <PathMap points={args.path ?? []} authorName="Karim" summary="Окленд → Сідней → Дубай → Каїр" />
      <PathLegend />
    </Stage>
  ),
};
