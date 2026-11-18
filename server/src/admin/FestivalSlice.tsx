/** Festival-state slice of the first screen (AC-75): the live view is a client part that polls `/cms-api/festival-state`. */
import { envClass } from '../platform/env';
import { FestivalStateView } from './FestivalStateView';

export function FestivalSlice() {
  // Controls exist only where `POST /cms-api/clock` does: rehearsal and test. Production stays read-only.
  const controls = envClass(process.env) !== 'production';
  return <FestivalStateView controls={controls} />;
}
