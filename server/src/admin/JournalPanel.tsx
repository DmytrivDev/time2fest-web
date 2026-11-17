/** Last 20 journal rows of the first screen (AC-26) with a revert button for revertible rows (AC-24). Server component. */
import type { PayloadRequest } from 'payload';
import { RevertButton } from './RevertButton';

interface Row {
  id: number | string;
  at: string;
  action: string;
  revertible?: boolean;
  actor?: { label?: string };
  target?: { collection?: string; ref?: string };
}

const kyiv = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'medium' });

export async function JournalPanel({ req }: { req: PayloadRequest }) {
  const found = await req.payload.find({
    collection: 'audit-log',
    sort: '-at',
    limit: 20,
    depth: 0,
    user: req.user,
    overrideAccess: false,
  });
  const rows = found.docs as unknown as Row[];
  return (
    <section data-testid="journal">
      <h2>Журнал змін</h2>
      {rows.length === 0 ? (
        <p>Записів ще немає.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Час (Київ)</th>
              <th>Хто</th>
              <th>Дія</th>
              <th>Що</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)} data-testid="journal-row" data-revertible={r.revertible === true ? 'true' : 'false'}>
                <td>{kyiv.format(new Date(r.at))}</td>
                <td>{r.actor?.label ?? ''}</td>
                <td>{r.action}</td>
                <td>{`${r.target?.collection ?? ''} ${r.target?.ref ?? ''}`}</td>
                <td>{r.revertible === true ? <RevertButton id={String(r.id)} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
