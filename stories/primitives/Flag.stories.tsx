import type { Meta, StoryObj } from '@storybook/nextjs';
import { Flag, type FlagSize } from '@/components/primitives/Flag';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/Flag', component: Flag, args: { code: 'UA', size: 'sm', name: 'Україна' } } satisfies Meta<typeof Flag>;
export default meta;
type Story = StoryObj<typeof meta>;

const SIZES: FlagSize[] = ['xs', 'card', 'pill', 'sm', 'md', 'xl', 'lg'];

export const Sizes: Story = {
  render: () => (
    <Stage>
      <StateRow label="лише круглі (2026-11-13): xs 16 · card 16 · pill 18 · sm 20 · md 26 · xl 40 · lg 48 (обводка однакова)">
        {SIZES.map((s) => (
          <Flag key={s} code="UA" size={s} name="Україна" />
        ))}
      </StateRow>
    </Stage>
  ),
};

export const Countries: Story = {
  render: () => (
    <Stage>
      <StateRow label="країни (SVG, не емодзі)">
        {['FR', 'DE', 'IT', 'ES', 'GB', 'US', 'BR', 'JP', 'NZ', 'AE', 'EG', 'CA'].map((c) => (
          <Flag key={c} code={c} size="md" decorative />
        ))}
      </StateRow>
    </Stage>
  ),
};

export const Special: Story = {
  name: 'Особливі прапори (O-NICK)',
  render: () => (
    <Stage>
      <StateRow label="Земля («Без країни»), ООН, ЄС, Англія, Шотландія, Уельс, ЛГБТ, трансгендерний, бісексуальний">
        <Flag code="earth" size="lg" name="Без країни" />
        <Flag code="un" size="lg" name="ООН" />
        <Flag code="EU" size="lg" name="ЄС" />
        <Flag code="GB-ENG" size="lg" name="Англія" />
        <Flag code="GB-SCT" size="lg" name="Шотландія" />
        <Flag code="GB-WLS" size="lg" name="Уельс" />
        <Flag code="pride" size="lg" name="ЛГБТ" />
        <Flag code="trans" size="lg" name="Трансгендерний прайд" />
        <Flag code="bisexual" size="lg" name="Бісексуальний прайд" />
      </StateRow>
    </Stage>
  ),
};

export const WithAndWithoutName: Story = {
  name: 'Доступна назва «Прапор: <країна>» чи прикраса поруч з текстом',
  render: () => (
    <Stage>
      <StateRow label="з назвою (role=img, aria-label «Прапор: Франція») · decorative поруч із назвою">
        <Flag code="FR" size="sm" name="Франція" />
        <span className="inline-flex items-center gap-2 text-body text-text">
          <Flag code="FR" size="sm" decorative />
          Франція
        </span>
      </StateRow>
    </Stage>
  ),
};
