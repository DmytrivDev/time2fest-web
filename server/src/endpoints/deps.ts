/**
 * Typed getters over the ports `createDeps` builds once (`Deps.events`, `.catalogStore`, …). The fields are
 * optional on `Deps` only so that a test can build a plain `Deps`; a getter throws a clear error when the
 * deps were not built by `createDeps`. Route handlers read them from `ctx.deps`.
 */
import type { AlarmService } from '../alarms/service';
import type { AlarmStore } from '../alarms/ports';
import type { CatalogStore } from '../catalog/ports';
import type { CorrectionDeps } from '../corrections/service';
import type { UnattendedDeps } from '../unattended/service';
import type { Deps, EventPorts } from './types';

function built<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`deps: ${name} missing (deps not built by createDeps)`);
  return value;
}

/** The internal-events ports (AC-40 … AC-42). */
export const eventsOf = (deps: Deps): EventPorts => built(deps.events, 'events');
/** The alarm store (AC-37 … AC-39). */
export const alarmStoreOf = (deps: Deps): AlarmStore => built(deps.alarmStore, 'alarmStore');
/** The alarm use cases over `alarmStoreOf`. */
export const alarmServiceOf = (deps: Deps): AlarmService => built(deps.alarmService, 'alarmService');
/** The catalog read port (AC-63). */
export const catalogStoreOf = (deps: Deps): CatalogStore => built(deps.catalogStore, 'catalogStore');
/** The correction service dependencies (AC-53 … AC-62). */
export const correctionsOf = (deps: Deps): CorrectionDeps => built(deps.corrections, 'corrections');
/** The unattended-mode service dependencies (AC-31 … AC-36). */
export const unattendedDepsOf = (deps: Deps): UnattendedDeps => built(deps.unattended, 'unattended');
