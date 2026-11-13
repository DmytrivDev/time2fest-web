import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetAllResources } from '@/lib/api/resource';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Кеш шва (`lib/api/resource`) — модульний: без скидання дані одного тесту протікали б в інший.
  resetAllResources();
});
afterEach(() => {
  cleanup();
});
