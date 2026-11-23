/** Межі хвилі realtime (SPEC-06): AC-55 — realtime не входить до http-доменів; NFR-6 — закріплені версії Centrifugo і centrifuge-js. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HTTP_DOMAINS } from '../../../lib/api/http/domains';

const root = path.resolve(__dirname, '../../..');

describe('межі хвилі realtime', () => {
  it('AC-55: HTTP_DOMAINS містить лише catalog, site (SPEC-08) і live (SPEC-12)', () => {
    expect([...HTTP_DOMAINS]).toEqual(['catalog', 'site', 'live']);
  });

  it('AC-55: верхньорівневі файли lib/api/http/*.ts не імпортують ./realtime; винятки SPEC-08 — site.ts і SPEC-12 — live.ts: лише типи й динамічний import за прапорцем збірки', () => {
    const dir = path.join(root, 'lib/api/http');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const anyImport = /from\s+['"]\.\/realtime(\/[^'"]*)?['"]|import\(\s*['"]\.\/realtime/g;
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (f !== 'site.ts' && f !== 'live.ts') {
        expect(src, f).not.toMatch(anyImport);
        continue;
      }
      const allowedType = /^import type \{[^}]*\} from '\.\/realtime\/types';$/m;
      const allowedDynamic = /process\.env\.NEXT_PUBLIC_REALTIME_URL\s*\?\s*\(\) => import\('\.\/realtime'\)/;
      expect(src, f).toMatch(allowedType);
      expect(src, f).toMatch(allowedDynamic);
      const rest = src.replace(allowedType, '').replace(allowedDynamic, '');
      expect(rest, f).not.toMatch(anyImport);
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
