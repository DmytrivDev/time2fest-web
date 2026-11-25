/**
 * Pass view of a session (SPEC-11 W11, [П-7], FR-ID-14, AC-1, AC-3 … AC-9), ring 1: pure.
 * Inputs are the ACTIVE passes only (the caller filters by holiday): the signed-in account's own pass and the
 * device's unattached pass. The 8 rows of the FR-ID-14 table follow from these two facts:
 * - account pass → `passOn:'account'`, the device pass (if any) is still shown as `devicePass` (row 5);
 * - no account pass, device pass → `passOn:'device'` for any session of the device (rows 2, 7; AC-4);
 * - neither → no pass (rows 1, 3, 6, 8; row 4 is an account pass after attach).
 */

export interface ActivePass {
  /** Issue instant, epoch ms. */
  readonly since: number;
  /** Holiday key (`2026-27`). */
  readonly season: string;
}

export interface ActiveDevicePass extends ActivePass {
  /** Payment email of the unattached pass. */
  readonly email: string;
}

export interface PassViewInput {
  /** The signed-in account's active pass (`null` for a guest or an account without one). */
  readonly accountPass: ActivePass | null;
  /** The device's active unattached pass. */
  readonly devicePass: ActiveDevicePass | null;
  readonly signedIn: boolean;
}

export interface PassView {
  hasPass: boolean;
  passOn: 'account' | 'device' | null;
  passSince: number | null;
  passNight?: string;
  devicePass: { email: string; since: number } | null;
}

export function passView({ accountPass, devicePass, signedIn }: PassViewInput): PassView {
  const own = signedIn ? accountPass : null;
  const device = devicePass ? { email: devicePass.email, since: devicePass.since } : null;
  if (own) return { hasPass: true, passOn: 'account', passSince: own.since, passNight: own.season, devicePass: device };
  if (devicePass) return { hasPass: true, passOn: 'device', passSince: devicePass.since, passNight: devicePass.season, devicePass: device };
  return { hasPass: false, passOn: null, passSince: null, devicePass: null };
}
