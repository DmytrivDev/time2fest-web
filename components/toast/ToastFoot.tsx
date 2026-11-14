/** Закріплений низ кроку вікна тосту (кнопки дій). */
import type { ReactNode } from 'react';
import s from './toastWindow.module.css';

export function Foot({ children }: { children: ReactNode }) {
  return <div className={s.foot}>{children}</div>;
}
