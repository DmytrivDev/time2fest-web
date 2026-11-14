import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetAllResources } from '@/lib/api/resource';
import { AUTH_EMPTY, useAuthStore } from '@/stores/auth';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Кеш шва (`lib/api/resource`) — модульний: без скидання дані одного тесту протікали б в інший.
  resetAllResources();
  // «Сервер» імітації входу й пасів — модульний стор: неприєднані й приєднані паси не протікають між тестами.
  useAuthStore.setState(AUTH_EMPTY);
});
afterEach(() => {
  cleanup();
});
