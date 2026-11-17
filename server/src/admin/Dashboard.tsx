/**
 * First admin screen (AC-26 … AC-28): the slots of the registry in order, each inside its own error
 * boundary, then the journal panel. Server component, `admin.components.views.dashboard`.
 */
import type { AdminViewServerProps } from 'payload';
import type { ReactNode } from 'react';
import { envClass } from '../platform/env';
import { ADMIN_TEST_SLICE_FAIL, visibleSlots } from '../registries/adminSlots';
import { CorrectionsSlice } from './CorrectionsSlice';
import { JournalPanel } from './JournalPanel';
import { SliceBoundary } from './SliceBoundary';
import { TestSlice } from './TestSlice';
import { UnattendedSlice } from './UnattendedSlice';

export function Dashboard({ initPageResult }: AdminViewServerProps) {
  const { req } = initPageResult;
  const fail = (globalThis as Record<symbol, unknown>)[ADMIN_TEST_SLICE_FAIL] === true;
  const slices: Record<string, () => ReactNode> = {
    '10-corrections': () => <CorrectionsSlice />,
    '20-unattended': () => <UnattendedSlice />,
    '90-test': () => <TestSlice fail={fail} />,
  };
  const slots = visibleSlots(envClass(process.env));
  return (
    <div className="gutter--left gutter--right" data-testid="dashboard">
      <h1>Панель власника</h1>
      {slots.map((slot) => (
        <section key={slot.key} data-slice={slot.key}>
          <h2>{slot.label}</h2>
          <SliceBoundary label={slot.label}>{slices[slot.key]?.()}</SliceBoundary>
        </section>
      ))}
      <SliceBoundary label="Журнал змін">
        <JournalPanel req={req} />
      </SliceBoundary>
    </div>
  );
}
