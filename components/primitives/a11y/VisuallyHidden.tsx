import { VisuallyHidden as RadixVisuallyHidden } from 'radix-ui';
import type { ComponentProps } from 'react';

/** P31. Текст лише для зчитувача (Radix VisuallyHidden). */
export function VisuallyHidden(props: ComponentProps<typeof RadixVisuallyHidden.Root>) {
  return <RadixVisuallyHidden.Root {...props} />;
}
