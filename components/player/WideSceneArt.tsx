/** Широка сцена набору країни (480×200) у сцені відліку — кадрування в `WideSceneArt.module.css`. */
import type { CSSProperties } from 'react';
import s from './WideSceneArt.module.css';

export function WideSceneArt({
  src,
  sky,
  water,
}: {
  src: string;
  sky?: string | undefined;
  water?: string | undefined;
}) {
  const style = {
    ...(sky ? { '--scene-sky': sky } : {}),
    ...(water ? { '--scene-water': water } : {}),
  } as CSSProperties;
  return (
    <div className={s.box} style={style} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- статичний SVG сцени */}
      <img src={src} alt="" className={s.img} />
    </div>
  );
}
