/** Site state (SPEC-08): switches, payments pause, product selections. Only the site service writes it; the slice is the UI. */
import type { GlobalConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const never = () => false;
const field = { readOnly: true, hidden: true } as const;

export const siteState: GlobalConfig = {
  slug: 'site-state',
  label: 'Стан сайту',
  admin: { group: 'Сайт' },
  access: { read: ownerOnly, update: never, readVersions: ownerOnly },
  fields: [
    { name: 'version', type: 'number', defaultValue: 1, admin: field },
    { name: 'at', type: 'date', admin: field },
    {
      name: 'switches',
      type: 'json',
      defaultValue: {
        chat: true,
        toasts: true,
        pass: true,
        passGift: true,
        payments: true,
        viewersMap: true,
        passOffer: true,
        chatRooms: {},
        toastTiers: { '2': true, '5': true, '10': true },
      },
      admin: field,
    },
    {
      name: 'paymentsPause',
      type: 'select',
      options: [
        { label: 'Вручну', value: 'manual' },
        { label: 'Автоматично', value: 'auto' },
      ],
      admin: field,
    },
    { name: 'productSelections', type: 'json', defaultValue: {}, admin: field },
    { name: 'rebuildDueAt', type: 'date', admin: field },
    { name: 'rebuildDeferred', type: 'checkbox', defaultValue: false, admin: field },
    { name: 'lastFannedOut', type: 'number', defaultValue: 0, admin: field },
  ],
};
