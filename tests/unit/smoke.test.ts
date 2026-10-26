import { expect, it } from 'vitest';

it('середовище Vitest працює', () => {
  localStorage.setItem('k', 'v');
  expect(localStorage.getItem('k')).toBe('v');
});
