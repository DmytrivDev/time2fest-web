import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { ErrorContent } from '@/components/shell/ErrorContent';
import { NotFoundContent } from '@/components/shell/NotFoundContent';
import { StaticShell } from '@/components/shell/StaticShell';
import messages from '@/messages/uk.json';

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages}>
      <StaticShell>{ui}</StaticShell>
    </NextIntlClientProvider>,
  );
}

describe('404 і помилка', () => {
  it('404: заголовок, два посилання, хедер і футер, один main', () => {
    wrap(<NotFoundContent />);
    expect(screen.getByRole('heading', { level: 1, name: 'Такої сторінки немає' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'На головну' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Список країн' }).getAttribute('href')).toBe('/countries');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
  });

  it('помилка: «Спробувати ще раз» викликає retry', async () => {
    const retry = vi.fn();
    wrap(<ErrorContent onRetry={retry} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Щось пішло не так' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'На головну' }).getAttribute('href')).toBe('/');
  });
});
