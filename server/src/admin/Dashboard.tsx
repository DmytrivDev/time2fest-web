/**
 * First admin screen (AC-26 … AC-28): the slots of the registry in order, each inside its own error
 * boundary, then the journal panel. Server component, `admin.components.views.dashboard`. The registry is
 * the only place that names a slice component; a row whose component cannot be loaded renders a visible error.
 */
import type { AdminViewServerProps } from 'payload';
import { envClass } from '../platform/env';
import { adminTestSliceFails, visibleSlots } from '../registries/adminSlots';
import { JournalPanel } from './JournalPanel';
import { SliceBoundary } from './SliceBoundary';

export async function Dashboard({ initPageResult }: AdminViewServerProps) {
  const { req } = initPageResult;
  const fail = adminTestSliceFails();
  const slots = await Promise.all(
    visibleSlots(envClass(process.env)).map(async (slot) => ({ slot, Slice: await slot.load().catch(() => undefined) })),
  );
  return (
    <div className="gutter--left gutter--right" data-testid="dashboard">
      <h1>Панель власника</h1>
      {slots.map(({ slot, Slice }) => (
        <section key={slot.key} data-slice={slot.key}>
          <h2>{slot.label}</h2>
          <SliceBoundary label={slot.label}>
            {Slice ? <Slice fail={fail} /> : <p role="alert" data-testid="slice-missing">{`Зріз «${slot.label}» не знайдено`}</p>}
          </SliceBoundary>
        </section>
      ))}
      <SliceBoundary label="Журнал змін">
        <JournalPanel req={req} />
      </SliceBoundary>
    </div>
  );
}
