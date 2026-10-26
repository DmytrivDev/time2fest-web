import { REDUCED_MOTION_INIT_SCRIPT } from './reducedMotionScript';

/**
 * Серверний компонент для `<head>` кореневого `app/layout.tsx`.
 * На `<html>` потрібен `suppressHydrationWarning`: атрибут з’являється до React.
 */
export function ReducedMotionScript() {
  return <script dangerouslySetInnerHTML={{ __html: REDUCED_MOTION_INIT_SCRIPT }} />;
}
