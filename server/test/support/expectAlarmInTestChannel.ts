/**
 * SPEC-13b W39 (AC-28): `expectAlarmInTestChannel({source, code}, trigger, fake)` runs `trigger`, then waits (≤60 s)
 * for a message in the Telegram fake that carries the registry domain title and the `meaning` of the kind.
 * The server under test must send to `fake` (its env from `startTelegramFake().env`) and have its ops runner
 * running, or `flush` must drive the sender (e.g. the `ops-tick` door with `jobs: ['sender']`).
 * Returns the elapsed ms from the trigger to the message.
 */
import { findKind } from '../../src/registries/ops';
import type { FakeTelegramCall, FakeTelegramHandle } from './fakeTelegram';

export const ALARM_WAIT_MS = 60_000;

export interface ExpectAlarmOptions {
  timeoutMs?: number;
  /** Called on every poll before reading the fake (pushes the sender along when no ticker runs). */
  flush?: () => Promise<void>;
  pollMs?: number;
}

export async function expectAlarmInTestChannel(
  kind: { source: string; code: string },
  trigger: () => Promise<unknown>,
  fake: Pick<FakeTelegramHandle, 'calls' | 'reset'>,
  opts: ExpectAlarmOptions = {},
): Promise<number> {
  const row = findKind(kind.source, kind.code);
  if (!row) throw new Error(`expectAlarmInTestChannel: ${kind.source}/${kind.code} is not in the ops registry`);
  const timeoutMs = opts.timeoutMs ?? ALARM_WAIT_MS;
  const matches = (c: FakeTelegramCall) =>
    typeof c.text === 'string' && c.text.includes(`Домен: ${row.domain.title}`) && c.text.includes(row.alarm.meaning);
  await fake.reset();
  const started = Date.now();
  await trigger();
  for (;;) {
    if (opts.flush) await opts.flush();
    if ((await fake.calls()).some(matches)) return Date.now() - started;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`no Telegram message for ${kind.source}/${kind.code} (domain "${row.domain.title}") within ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 250));
  }
}
