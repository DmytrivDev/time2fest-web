import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Header } from '@/components/shell/Header';
import type { CelebrationStamp } from '@/lib/stamp/stampCelebration';

const meta = {
  title: 'Оболонка/Header',
  component: Header,
  args: { current: 'home' },
} satisfies Meta<typeof Header>;
export default meta;
type Story = StoryObj<typeof meta>;

// Телефон 56 px · планшет · десктоп 64 px: різниця лише в CSS, склад — за ІНВ C23.
export const Phone: Story = { name: 'Телефон 390 (56 px)', globals: { viewport: { value: 'phone', isRotated: false } } };

export const PhoneWithPass: Story = { name: 'Телефон · «Пас ✓»', globals: { viewport: { value: 'phone', isRotated: false } }, args: { hasPass: true } };

export const PhoneSignedIn: Story = {
  name: 'Телефон · аватар',
  globals: { viewport: { value: 'phone', isRotated: false } },
  args: { user: { name: 'Аміра' } },
};

export const Tablet: Story = {
  name: 'Планшет 768 (Головна, Країни, мова, «Пас», вхід, меню)',
  globals: { viewport: { value: 'tablet', isRotated: false } },
};

export const Desktop: Story = { name: 'Десктоп 1440 (64 px)', globals: { viewport: { value: 'desktop', isRotated: false } } };

export const DesktopWithPass: Story = {
  name: 'Десктоп · «Новорічний пас ✓», профіль',
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { hasPass: true, user: { name: 'Олена' }, current: 'countries' },
};

export const MenuOpen: Story = {
  name: 'Телефон · «Меню» розгорнуто (aria-expanded)',
  globals: { viewport: { value: 'phone', isRotated: false } },
  args: { menuOpen: true },
};

export const FocusOrder: Story = {
  name: 'Фокус клавіатури (десктоп)',
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async () => {
    await userEvent.tab();
    await userEvent.tab();
  },
};

// ── Свято штампа в шапці (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header` v2, рішення власника 2026-11-12) ──
// Фаза задається пропом: fill (0–0,4 с) · show (до 8 с) · fly (8–9,2 с) · settle (до 10 с). Усе — у межах шапки.
const FR: CelebrationStamp = { eventId: 'evt_paris_2027', country: 'Франція', gender: 'f', flagCode: 'FR', grantedAt: 0 };
const GB: CelebrationStamp = { eventId: 'evt_london_2027', country: 'Велика Британія', gender: 'f', flagCode: 'GB', grantedAt: 0 };
const DE: CelebrationStamp = { eventId: 'evt_berlin_2027', country: 'Німеччина', gender: 'f', flagCode: 'DE', grantedAt: 0 };
const IT: CelebrationStamp = { eventId: 'evt_rome_2027', country: 'Італія', gender: 'f', flagCode: 'IT', grantedAt: 0 };
const VC: CelebrationStamp = { eventId: 'evt_vc', country: 'Сент-Вінсент і Гренадини', gender: 'pl', flagCode: 'VC', grantedAt: 0 };
const user = { name: 'Олена', flag: 'UA' };
const cel = (kind: 'now' | 'fullscreen' | 'tab', stamps: CelebrationStamp[], extra: { phase?: 'fill' | 'show' | 'fly' | 'settle'; reduced?: boolean; guest?: boolean } = {}) => ({
  celebration: { id: 1, kind, stamps },
  phase: extra.phase ?? 'show',
  reduced: extra.reduced ?? false,
  paused: false,
  guest: extra.guest ?? false,
});
const desk = { viewport: { value: 'desktop', isRotated: false } };
const phone = { viewport: { value: 'phone', isRotated: false } };

export const CelebrationDesk: Story = {
  name: 'Свято · десктоп: «З Новим роком, Франція!» (1 с)',
  globals: desk,
  args: { user, notifications: 3, celebration: cel('now', [FR]) },
};
export const CelebrationDeskFill: Story = {
  name: 'Свято · десктоп: заливка (0 с)',
  globals: desk,
  args: { user, notifications: 3, celebration: cel('now', [FR], { phase: 'fill' }) },
};
export const CelebrationDeskFly: Story = {
  name: 'Свято · десктоп: штамп летить (8 с)',
  globals: desk,
  args: { user, notifications: 3, celebration: cel('now', [FR], { phase: 'fly' }) },
};
export const CelebrationDeskAfter: Story = {
  name: 'Свято · десктоп: після (10 с) — дзвіночок +1, аватар світиться',
  globals: desk,
  args: { user, notifications: 4, avatarGlow: true },
};
export const CelebrationDeskFullscreen: Story = {
  name: 'Свято · десктоп: після повного екрана, 2 штампи',
  globals: desk,
  args: { user, notifications: 3, celebration: cel('fullscreen', [FR, GB]) },
};
export const CelebrationDeskTab: Story = {
  name: 'Свято · десктоп: повернення на вкладку',
  globals: desk,
  args: { user, notifications: 3, celebration: cel('tab', [FR]) },
};
export const CelebrationDeskRoom: Story = {
  name: 'Свято · десктоп: кімната, 3 штампи разом',
  globals: desk,
  args: { user, notifications: 3, celebration: cel('now', [FR, DE, IT]) },
};
export const CelebrationDeskReduced: Story = {
  name: 'Свято · десктоп: «Зменшити рух» (статично)',
  globals: desk,
  args: { user, notifications: 3, celebration: cel('now', [FR], { reduced: true }) },
};
export const CelebrationDeskGuest: Story = {
  name: 'Свято · десктоп: гість, довга назва',
  globals: desk,
  args: { notifications: 1, celebration: cel('now', [VC], { guest: true }) },
};
export const CelebrationPhone: Story = {
  name: 'Свято · телефон: два рядки',
  globals: phone,
  args: { user, notifications: 3, celebration: cel('now', [FR]) },
};
export const CelebrationPhoneLong: Story = {
  name: 'Свято · телефон: довга назва — коротка форма',
  globals: phone,
  args: { user, notifications: 3, celebration: cel('now', [VC]) },
};
export const CelebrationPhoneFullscreen: Story = {
  name: 'Свято · телефон: після повного екрана',
  globals: phone,
  args: { user, notifications: 3, celebration: cel('fullscreen', [FR]) },
};
export const CelebrationPhoneGuest: Story = {
  name: 'Свято · телефон: гість — «Штамп на цьому пристрої»',
  globals: phone,
  args: { notifications: 1, celebration: cel('now', [FR], { guest: true }) },
};
