/** Festival-state slice of the first screen (AC-75): the live view is a client part that polls `/cms-api/festival-state`. */
import { envClass } from '../platform/env';
import { CLOCK_CONTROL_CLASSES } from '../timekeeping/control';
import { FestivalStateView } from './FestivalStateView';

export function FestivalSlice() {
  // Controls exist only where `POST /cms-api/clock` does: rehearsal and test. Production stays read-only.
  const controls = CLOCK_CONTROL_CLASSES.includes(envClass(process.env));
  return <FestivalStateView controls={controls} />;
}
