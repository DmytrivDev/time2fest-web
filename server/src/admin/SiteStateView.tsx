'use client';
/**
 * «Стан сайту» view (SPEC-08 AC-17): pure props → markup. The nine switches with their values (rooms and tiers
 * included), the payments pause mode, the reason field and one product select per key. The reason is always text.
 */
import type { ProductKey, SiteState } from '@time2fest/contracts';
import { SITE_PRODUCT_LABELS, SITE_SWITCH_LABELS, SITE_TEXT } from './messages';

export interface SiteProductOption {
  id: string;
  key: ProductKey;
  price: { amount: number; currency: string };
}

type Extra = { room?: string; tier?: string };

export interface SiteStateViewProps {
  state: SiteState;
  paymentsPause: 'manual' | 'auto' | null;
  products: readonly SiteProductOption[];
  /** The chosen product id by key. */
  selections: Readonly<Partial<Record<ProductKey, { productId: string }>>>;
  reason?: string;
  room?: string;
  message?: string;
  onReason?: (v: string) => void;
  onRoom?: (v: string) => void;
  onSwitch?: (key: string, value: boolean, extra?: Extra) => void;
  onProduct?: (key: ProductKey, productId: string) => void;
}

const BOOLEAN_KEYS = ['chat', 'toasts', 'pass', 'passGift', 'payments', 'viewersMap', 'viewersCount', 'passOffer'] as const;
const TIERS = ['2', '5', '10'] as const;
const PRODUCT_KEYS: readonly ProductKey[] = ['pass', 'toast:2', 'toast:5', 'toast:10'];
const PAUSE: Record<string, string> = { manual: SITE_TEXT.pauseManual, auto: SITE_TEXT.pauseAuto };

const money = (m: { amount: number; currency: string }) => `${m.currency === 'USD' ? '$' : `${m.currency} `}${(m.amount / 100).toFixed(2)}`;
const word = (on: boolean) => (on ? SITE_TEXT.on : SITE_TEXT.off);

export function SiteStateView(p: SiteStateViewProps) {
  const { switches } = p.state;
  const button = (testId: string, key: string, value: boolean, extra?: Extra) => (
    <button type="button" data-testid={testId} onClick={() => p.onSwitch?.(key, value, extra)}>
      {value ? SITE_TEXT.turnOn : SITE_TEXT.turnOff}
    </button>
  );
  const closedRooms = Object.entries(switches.chatRooms)
    .filter(([, open]) => !open)
    .map(([name]) => name);
  const room = (p.room ?? '').trim();

  return (
    <div data-testid="site-slice">
      <p data-testid="site-version">{`${SITE_TEXT.version}: ${p.state.version}`}</p>
      <label style={{ display: 'block' }}>
        {SITE_TEXT.reason}
        <input name="reason" type="text" maxLength={200} value={p.reason ?? ''} onChange={(e) => p.onReason?.(e.target.value)} />
      </label>
      <ul>
        {BOOLEAN_KEYS.map((key) => (
          <li key={key} data-testid={`switch-${key}`}>
            {`${SITE_SWITCH_LABELS[key]}: ${word(switches[key])} `}
            {button(`toggle-${key}`, key, !switches[key])}
          </li>
        ))}
        <li data-testid="switch-chatRooms">
          {`${SITE_TEXT.rooms}: ${closedRooms.length === 0 ? SITE_TEXT.roomsAllOpen : closedRooms.map((r) => `${r} — ${SITE_TEXT.off}`).join(', ')} `}
          <input name="room" type="text" aria-label={SITE_TEXT.roomName} value={p.room ?? ''} onChange={(e) => p.onRoom?.(e.target.value)} />
          {room ? button('toggle-room-close', 'chatRooms', false, { room }) : null}
          {room ? button('toggle-room-open', 'chatRooms', true, { room }) : null}
        </li>
        <li data-testid="switch-toastTiers">
          {TIERS.map((tier) => (
            <span key={tier} data-testid={`tier-${tier}`}>
              {`$${tier}: ${word(switches.toastTiers[tier])} `}
              {button(`toggle-tier-${tier}`, 'toastTiers', !switches.toastTiers[tier], { tier })}
            </span>
          ))}
        </li>
      </ul>
      <p data-testid="payments-pause">{`${SITE_TEXT.pause}: ${p.paymentsPause ? PAUSE[p.paymentsPause] : SITE_TEXT.pauseNone}`}</p>
      <section data-testid="site-products">
        <h3>{SITE_TEXT.products}</h3>
        {p.products.length === 0 ? (
          <p data-testid="site-products-empty">{SITE_TEXT.noProducts}</p>
        ) : (
          PRODUCT_KEYS.map((key) => (
            <label key={key} style={{ display: 'block' }}>
              {SITE_PRODUCT_LABELS[key]}
              <select
                name={`product-${key}`}
                data-testid={`product-${key}`}
                value={p.selections[key]?.productId ?? ''}
                onChange={(e) => (e.target.value ? p.onProduct?.(key, e.target.value) : undefined)}
              >
                <option value="">{SITE_TEXT.choose}</option>
                {p.products
                  .filter((o) => o.key === key)
                  .map((o) => (
                    <option key={o.id} value={o.id}>{`${o.id} — ${money(o.price)}`}</option>
                  ))}
              </select>
            </label>
          ))
        )}
      </section>
      {p.message ? <p role="alert">{p.message}</p> : null}
    </div>
  );
}
