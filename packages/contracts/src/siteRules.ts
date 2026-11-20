/** Pure rules over the site switches (SPEC-08, C5): one decision shared by server and site. */
import type { SiteSwitches } from './site';

export type IsEnabledTarget =
  | { kind: 'product'; key: 'pass' | 'passGift' }
  | { kind: 'tier'; tier: '2' | '5' | '10' }
  | { kind: 'room'; room: string }
  | { kind: 'switch'; key: 'chat' | 'viewersMap' | 'passOffer' };

export function isEnabled(switches: SiteSwitches, target: IsEnabledTarget): boolean {
  switch (target.kind) {
    case 'product':
      return switches[target.key] && switches.payments;
    case 'tier':
      return switches.toasts && switches.toastTiers[target.tier] && switches.payments;
    case 'room':
      return switches.chat && switches.chatRooms[target.room] !== false;
    case 'switch':
      return switches[target.key];
  }
}
