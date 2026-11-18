'use client';

/** «Питання й відповіді» внутрішніх сторінок: акордеон, відкривається плавно; відповіді завжди в розмітці. */
import { useId, useState } from 'react';
import { Icon } from '@/components/primitives/Icon';
import s from './site.module.css';

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const base = useId();
  const [open, setOpen] = useState(0);
  return (
    <div className={s.faq}>
      {items.map((item, i) => {
        const isOpen = open === i;
        const panel = `${base}-a${i}`;
        return (
          <div className={s.qa} data-open={isOpen} key={item.q}>
            <h3>
              <button
                type="button"
                className={s.qaBtn}
                aria-expanded={isOpen}
                aria-controls={panel}
                onClick={() => setOpen(isOpen ? -1 : i)}
              >
                {item.q}
                <Icon name="plus" size={20} />
              </button>
            </h3>
            <div
              className={s.qaBody}
              id={panel}
              role="region"
              aria-hidden={!isOpen}
              inert={!isOpen}
            >
              <div>
                <p>{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
