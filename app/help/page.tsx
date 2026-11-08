import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Допомога — Time2Fest', description: 'Відповіді на часті питання про Time2Fest.' };

/** «Допомога» (меню й футер, 2026-11-08): часті питання у форматі службових сторінок (S-LEGAL). */
export default function Page() {
  return <LegalPage id="help" />;
}
