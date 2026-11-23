/**
 * `pnpm run live hide <eventId> <sourceId> --reason <text>` (SPEC-12 AC-52, [А16]). Ring 4 entry point, run by the
 * operator on the node at the owner's word (no HTTP surface). The hide goes through `applyLiveAction` with the actor
 * «оператор»: the same transaction as the owner's hide (source hidden, version bump, one journal row, one
 * `live.changed` in the outbox — the server's delivery loop fans it out as the `hide` event). The revert is the
 * owner's, from the admin journal.
 *
 * Output: one line. Exit codes: 0 done (or nothing to change), 2 refused (usage, missing reason, unknown event or
 * source), 1 failed. No environment value and no error message is ever printed (a message may carry a connection
 * string).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLiveAction, liveReason, OPERATOR_ACTOR, type LiveActionsDeps } from '../live/actions';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const LIVE_USAGE = 'usage: live hide <eventId> <sourceId> --reason <text>';

/** Ids as the catalog writes them: no spaces, no control characters. */
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export type LiveCommand = { cmd: 'hide'; eventId: string; sourceId: string; reason: string };

export function parseLiveArgs(argv: readonly string[]): { ok: true; command: LiveCommand } | { ok: false; message: string } {
  const bad = (why: string) => ({ ok: false as const, message: `live: ${why}; ${LIVE_USAGE}` });
  const [verb, eventId, sourceId, flag, ...rest] = argv;
  if (verb !== 'hide') return bad('unknown command');
  if (eventId === undefined || sourceId === undefined || !ID.test(eventId) || !ID.test(sourceId)) return bad('hide needs <eventId> <sourceId>');
  if (flag !== '--reason') return bad('hide needs --reason <text>');
  const reason = liveReason(rest.join(' '));
  if (reason === null) return bad('the reason is 1 … 200 characters');
  return { ok: true, command: { cmd: 'hide', eventId, sourceId, reason } };
}

export interface LiveCliPorts {
  actions: LiveActionsDeps;
  close(): Promise<void>;
}

export interface LiveCliIo {
  out(line: string): void;
  err(line: string): void;
}

export async function runLive(argv: readonly string[], io: LiveCliIo, open: () => Promise<LiveCliPorts>): Promise<number> {
  const parsed = parseLiveArgs(argv);
  if (!parsed.ok) {
    io.err(parsed.message);
    return 2;
  }
  const { eventId, sourceId, reason } = parsed.command;
  const ports = await open();
  try {
    const result = await applyLiveAction(ports.actions, null, OPERATOR_ACTOR, { action: 'hide', eventId, sourceId, reason });
    if (!result.ok) {
      io.err(result.reason === 'not-found' ? 'live: unknown event or source' : `live: refused (${result.reason})`);
      return 2;
    }
    io.out(JSON.stringify({ ok: true, version: result.version, changed: result.changed }));
    return 0;
  } finally {
    await ports.close();
  }
}

async function openPorts(): Promise<LiveCliPorts> {
  const [{ createDeps, payloadOf }, { liveActionsOf }] = await Promise.all([import('../container'), import('../registries/revertHandlers')]);
  const deps = createDeps(process.env);
  const payload = payloadOf(deps);
  return {
    actions: liveActionsOf(deps),
    close: () =>
      payload()
        .then((p) => p.destroy())
        .catch(() => undefined),
  };
}

async function main(): Promise<number> {
  const envFile = path.join(serverDir, '.env.local');
  if (process.env.DATABASE_URI === undefined && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  return runLive(process.argv.slice(2), { out: (l) => process.stdout.write(`${l}\n`), err: (l) => process.stderr.write(`${l}\n`) }, openPorts);
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`live: failed (${err instanceof Error ? err.name : 'error'})\n`);
      process.exit(1);
    },
  );
}
