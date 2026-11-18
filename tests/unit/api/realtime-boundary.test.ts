/** Межі хвилі realtime (SPEC-06): AC-55 — realtime не входить до http-доменів; NFR-6 — закріплені версії Centrifugo і centrifuge-js. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HTTP_DOMAINS } from '../../../lib/api/http/domains';

const root = path.resolve(__dirname, '../../..');

describe('межі хвилі realtime', () => {
  it('AC-55: HTTP_DOMAINS містить лише catalog', () => {
    expect([...HTTP_DOMAINS]).toEqual(['catalog']);
  });

  it('AC-55: жоден верхньорівневий файл lib/api/http/*.ts не імпортує ./realtime', () => {
    const dir = path.join(root, 'lib/api/http');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from\s+['"]\.\/realtime(\/[^'"]*)?['"]|import\(\s*['"]\.\/realtime/);
    }
  });

  it('NFR-6: образ Centrifugo закріплено у docker-compose.yml', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/^\s*image: centrifugo\/centrifugo:v6\.10\.3\s*$/m);
  });

  it('NFR-6: centrifuge закріплено точною версією 5.8.x', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.centrifuge).toMatch(/^5\.8\.\d+$/);
  });
});
