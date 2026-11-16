#!/usr/bin/env node
// @ts-check
/**
 * Runs a command under the machine integration lock (SPEC-02 AC-13 … AC-17).
 *
 *   node scripts/lock.mjs --mode shared|exclusive -- <cmd> [args...]
 *
 * The owner is `<worktree slug>:<pid>`. The child gets `T2F_LOCK_DIR` and `T2F_LOCK_MODE`,
 * the lease is renewed while it runs, the lock is released when it exits or on SIGINT/SIGTERM,
 * and this process exits with the child's code. No shell is involved.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { acquire, lockDir } from './lib/lock.mjs';
import { resolveWorktree } from './lib/worktree.mjs';

const USAGE = 'usage: node scripts/lock.mjs --mode shared|exclusive -- <cmd> [args...]';

/**
 * @param {string[]} argv
 * @returns {{ mode: 'shared' | 'exclusive', cmd: string[] }}
 */
function parseArgs(argv) {
  const sep = argv.indexOf('--');
  const head = sep === -1 ? argv : argv.slice(0, sep);
  const cmd = sep === -1 ? [] : argv.slice(sep + 1);
  const i = head.indexOf('--mode');
  const mode = i === -1 ? undefined : head[i + 1];
  if ((mode !== 'shared' && mode !== 'exclusive') || cmd.length === 0) throw new Error(USAGE);
  return { mode, cmd };
}

/**
 * Resolves `npx` without a shell: on Windows `npx.cmd` cannot be spawned with `shell: false`
 * (Node refuses .cmd files since CVE-2024-27980), so run npm's own `npx-cli.js` with this node.
 * @param {string[]} cmd
 * @returns {{ file: string, args: string[] }}
 */
function resolveCommand(cmd) {
  const [file = '', ...args] = cmd;
  if (file === 'npx' && process.platform === 'win32') {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (fs.existsSync(cli)) return { file: process.execPath, args: [cli, ...args] };
    return { file: 'npx.cmd', args };
  }
  return { file, args };
}

async function main() {
  const { mode, cmd } = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dir = lockDir(cwd, process.env);
  const owner = `${resolveWorktree(cwd, process.env).slug}:${process.pid}`;
  const lock = await acquire({ dir, owner, mode });

  const { file, args } = resolveCommand(cmd);
  const child = spawn(file, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, T2F_LOCK_DIR: dir, T2F_LOCK_MODE: mode },
  });

  /** @param {number} code */
  const finish = async (code) => {
    try {
      await lock.release();
    } catch (err) {
      console.error(`lock: release failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(code);
  };

  for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.on(sig, () => {
      child.kill(sig);
      void finish(sig === 'SIGINT' ? 130 : 143);
    });
  }
  child.on('error', (err) => {
    console.error(`lock: cannot start ${cmd[0]}: ${err.message}`);
    void finish(1);
  });
  child.on('exit', (code, signal) => {
    void finish(code ?? (signal ? 1 : 0));
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
