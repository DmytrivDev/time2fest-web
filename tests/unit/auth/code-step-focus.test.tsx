/**
 * Крок «Введи код із листа»: фокус — у полі коду, а не на заголовку кроку (2026-11-14). Ефекти дітей спрацьовують раніше
 * за батьківські, тож без перевірки заголовок забирав фокус у поля; у dev StrictMode ховав це подвійним запуском ефектів.
 * Тест не вмикає StrictMode — порядок ефектів у ньому той самий, що в робочій збірці.
 */
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { AuthSteps } from '@/components/auth/AuthSteps';
import type { AuthFlow } from '@/components/auth/useAuthFlow';
import messages from '@/messages/uk.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/' }));

const flow = (step: AuthFlow['step']) =>
  ({
    step,
    mode: 'login',
    code: '',
    codeEmail: 'a@example.com',
    codeState: { kind: 'idle' },
    setCode: vi.fn(),
    sending: false,
    resend: { kind: 'idle' },
    resendUntil: 0,
  }) as unknown as AuthFlow;

const ui = (f: AuthFlow) => (
  <NextIntlClientProvider locale="uk" messages={messages}>
    <AuthSteps flow={f} variant="page" onExit={() => {}} />
  </NextIntlClientProvider>
);

describe('фокус на кроці коду', () => {
  it('після переходу «пошта → код» фокус у полі коду, не на заголовку', () => {
    const { rerender } = render(ui(flow({ kind: 'form' })));
    rerender(ui(flow({ kind: 'code' })));
    expect(screen.getByRole('textbox', { name: 'Код із листа' })).toHaveFocus();
  });

  it('крок без власного поля: фокус на заголовку', () => {
    const { rerender } = render(ui(flow({ kind: 'form' })));
    rerender(ui(flow({ kind: 'perks' })));
    expect(document.activeElement?.hasAttribute('data-auth-title')).toBe(true);
  });
});
