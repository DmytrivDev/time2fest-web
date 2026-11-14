'use client';

/**
 * Екранна клавіатура для `ChatDock`: стежить за `visualViewport` і станом «пишемо в полі». Повертає видиму область,
 * відступ знизу (`inset`) і ознаку відкритої клавіатури (`kbUp`).
 */
import { useEffect, useRef, useState } from 'react';
import { KB_MIN, type DockViewport } from '@/components/chat/chatDockGeometry';

export function useDockViewport() {
  // Екранна клавіатура: visualViewport (Android/iOS зменшують лише візуальну область, макет лишається). Якщо клавіатура
  // зменшує сам макет (`resizes-content`, зміна розміру вікна) — inset = 0, а розміри вже правильні самі собою.
  const [vv, setVv] = useState<DockViewport>({ h: 0, off: 0, inner: 0, idle: 0 });
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  useEffect(() => {
    const v = window.visualViewport;
    const read = () => {
      const h = v ? v.height : window.innerHeight;
      setVv((cur) => {
        // `idle` — висота видимої області, коли поле не в фокусі (без клавіатури).
        const next = { h, off: v ? v.offsetTop : 0, inner: window.innerHeight, idle: typingRef.current ? cur.idle : h };
        return cur.h === next.h && cur.off === next.off && cur.inner === next.inner && cur.idle === next.idle ? cur : next;
      });
    };
    read();
    v?.addEventListener('resize', read);
    v?.addEventListener('scroll', read);
    window.addEventListener('resize', read);
    return () => {
      v?.removeEventListener('resize', read);
      v?.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, []);
  const inset = vv.h ? Math.max(0, vv.inner - vv.h - vv.off) : 0;
  const kbUp = vv.h > 0 && (inset > KB_MIN || (typing && vv.idle - vv.h > KB_MIN));
  return { vv, inset, kbUp, setTyping, typingRef };
}
