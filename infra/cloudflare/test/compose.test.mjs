// @ts-check
// Статична перевірка compose локального cloudflared: образ лише закріплений (без `:latest`), жоден порт не публікується.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../cloudflared/compose.yml');
const text = fs.readFileSync(file, 'utf8');
/** Рядки без коментарів. */
const code = text
  .split(/\r?\n/)
  .map((l) => l.replace(/#.*$/, ''))
  .join('\n');

describe('cloudflared/compose.yml', () => {
  it('немає :latest; образ — лише обов’язкова змінна CLOUDFLARED_IMAGE', () => {
    expect(text).not.toMatch(/:latest\b/i);
    expect(code).toMatch(/^\s*image:\s*\$\{CLOUDFLARED_IMAGE:\?[^}]*\}\s*$/m);
  });

  it('жоден порт не публікується', () => {
    expect(code).not.toMatch(/^\s*(ports|expose)\s*:/m);
    expect(code).not.toMatch(/network_mode:\s*["']?host/);
  });
});
