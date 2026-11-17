/** Unattended slice of the first screen (AC-38): reads the mode, windows and open `page` alarms; the controls are a client part. */
import { UnattendedControls } from './UnattendedControls';

const kyiv = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' });
const at = (ms: number) => kyiv.format(new Date(ms));

const CAUSES: Record<string, string> = { schedule: 'за розкладом', manual: 'вручну', alarm: 'через тривогу' };

export async function UnattendedSlice() {
  const { alarmStoreOf, getDeps, unattendedDepsOf } = await import('../container');
  const deps = getDeps();
  const { readUnattended } = await import('../unattended/service');
  const view = await readUnattended(unattendedDepsOf(deps).store);
  const open = await alarmStoreOf(deps).listOpenPage();
  return (
    <UnattendedControls
      on={view.state.on}
      causeText={view.state.cause ? (CAUSES[view.state.cause] ?? view.state.cause) : 'без причини'}
      manualUntil={view.manualUntil === null ? null : at(view.manualUntil)}
      windows={view.windows.map((w) => ({ id: String(w.id ?? `${w.startsAt}`), startsAt: at(w.startsAt), endsAt: at(w.endsAt) }))}
      alarms={open.map((a) => ({ id: a.id, source: a.source, code: a.code, raisedAt: at(a.raisedAt) }))}
    />
  );
}
