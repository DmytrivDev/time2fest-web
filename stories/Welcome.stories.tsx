import type { Meta, StoryObj } from '@storybook/nextjs';

function Welcome() {
  return <p className="text-body p-4">Time2Fest: каркас Storybook</p>;
}

const meta: Meta<typeof Welcome> = { title: 'Каркас/Welcome', component: Welcome };
export default meta;
export const Default: StoryObj<typeof Welcome> = {};
