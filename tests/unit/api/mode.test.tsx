/** Запобіжник шва: перемикач `NEXT_PUBLIC_API_MODE`, реєстр у режимі `http` без бекенду, стан «сервер недоступний». */
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiGuard } from '@/lib/api/ApiGuard';
import { API_MODE, parseApiMode, resolveApiMode } from '@/lib/api/mode';
import { MIGRATED_DOMAINS, missingDomains } from '@/lib/api/services';
import messages from '@/messages/uk.json';

afterEach(() => vi.restoreAllMocks());

describe('resolveApiMode — правило збирання', () => {
  it('не задано: тестова й демо-збірка — sim, будь-яка інша — http', () => {
    expect(resolveApiMode({ raw: undefined, testBuild: true, productionBuild: true })).toBe('sim');
    expect(resolveApiMode({ raw: undefined, testBuild: true, productionBuild: false })).toBe('sim');
    expect(resolveApiMode({ raw: undefined, testBuild: false, productionBuild: true })).toBe('http');
    expect(resolveApiMode({ raw: '', testBuild: false, productionBuild: false })).toBe('http');
  });

  it('задано явно — так і буде; http дозволено будь-де', () => {
    expect(resolveApiMode({ raw: 'http', testBuild: true, productionBuild: true })).toBe('http');
    expect(resolveApiMode({ raw: 'sim', testBuild: false, productionBuild: false })).toBe('sim');
    expect(resolveApiMode({ raw: 'sim', testBuild: true, productionBuild: true })).toBe('sim');
  });

  it('робоче збирання з імітацією без тестового прапорця — помилка; невідоме значення — помилка', () => {
    expect(() => resolveApiMode({ raw: 'sim', testBuild: false, productionBuild: true })).toThrow(/Робоча збірка з імітацією заборонена/);
    expect(() => resolveApiMode({ raw: 'mock', testBuild: true, productionBuild: false })).toThrow(/лише sim або http/);
  });

  it('рантайм читає вбудований літерал; без нього (vitest) — sim', () => {
    expect(parseApiMode('http')).toBe('http');
    expect(parseApiMode(undefined)).toBe('sim');
    expect(API_MODE).toBe('sim');
  });
});

describe('реєстр і «сервер недоступний»', () => {
  it('у sim є адаптери всіх перенесених доменів; у http — лише `catalog` (SPEC-04), `site` (SPEC-08) і `live` (SPEC-12), решти ще немає', () => {
    expect(missingDomains('sim')).toEqual([]);
    expect(missingDomains('http')).toEqual(MIGRATED_DOMAINS.filter((d) => d !== 'catalog' && d !== 'site' && d !== 'live'));
  });

  const wrap = (ui: React.ReactNode) =>
    render(
      <NextIntlClientProvider locale="uk" messages={messages}>
        {ui}
      </NextIntlClientProvider>,
    );

  it('http без адаптерів: замість сайту — BackendDown у main, помилка в консолі', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    wrap(
      <ApiGuard mode="http">
        <p>сайт</p>
      </ApiGuard>,
    );
    expect(screen.queryByText('сайт')).toBeNull();
    expect(document.querySelector('main#main [data-backend-down]')).not.toBeNull();
    expect(screen.getByText(messages.states.backendDown)).toBeTruthy();
    expect(err.mock.calls.some(([m]) => String(m).includes('сервіс недоступний'))).toBe(true);
  });

  it('sim: прозорий — сайт як є', () => {
    wrap(
      <ApiGuard mode="sim">
        <p>сайт</p>
      </ApiGuard>,
    );
    expect(screen.getByText('сайт')).toBeTruthy();
    expect(document.querySelector('[data-api-unavailable]')).toBeNull();
  });
});
