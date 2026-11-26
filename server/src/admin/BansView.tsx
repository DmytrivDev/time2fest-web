/** «Бани» view (SPEC-11 W38, AC-22): the ban list with «Зняти бан» and a small «Забанити» form (kind + id). */
import { useState } from 'react';

export interface BanRow {
  id: string;
  kind: 'account' | 'guest' | 'device';
  subjectId: string;
  createdAt: string;
  source: string;
  derived: number;
}

export const BANS_TEXT = {
  loading: 'Завантаження банів…',
  unavailable: 'Бани недоступні.',
  empty: 'Банів немає.',
  unban: 'Зняти бан',
  ban: 'Забанити',
  saved: 'Збережено.',
  failed: 'Не вдалося виконати дію.',
  notFound: 'Такого акаунта чи гостя немає.',
} as const;

const KIND_LABEL = { account: 'акаунт', guest: 'гість', device: 'пристрій' } as const;

export function BansView(props: {
  bans: BanRow[];
  message: string;
  onBan(kind: BanRow['kind'], subjectId: string): void;
  onUnban(banId: string): void;
}) {
  const [kind, setKind] = useState<BanRow['kind']>('account');
  const [subjectId, setSubjectId] = useState('');
  return (
    <div data-testid="bans-slice">
      {props.message ? <p role="status">{props.message}</p> : null}
      {props.bans.length === 0 ? (
        <p>{BANS_TEXT.empty}</p>
      ) : (
        <table>
          <tbody>
            {props.bans.map((b) => (
              <tr key={b.id}>
                <td>{KIND_LABEL[b.kind]}</td>
                <td>{b.subjectId}</td>
                <td>{b.createdAt}</td>
                <td>{b.source}</td>
                <td>{b.derived > 0 ? `+${b.derived}` : ''}</td>
                <td>
                  <button type="button" onClick={() => props.onUnban(b.id)}>
                    {BANS_TEXT.unban}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const id = subjectId.trim();
          if (id !== '') props.onBan(kind, id);
          setSubjectId('');
        }}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value as BanRow['kind'])} aria-label="Вид">
          <option value="account">{KIND_LABEL.account}</option>
          <option value="guest">{KIND_LABEL.guest}</option>
          <option value="device">{KIND_LABEL.device}</option>
        </select>
        <input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} maxLength={128} aria-label="Ідентифікатор" />
        <button type="submit">{BANS_TEXT.ban}</button>
      </form>
    </div>
  );
}
