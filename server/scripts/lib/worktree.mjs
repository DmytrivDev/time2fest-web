// @ts-check
/**
 * Worktree identity: slot, ports, slug and the isolated resource names derived from them
 * (SPEC-02 AC-7 … AC-10). Node built-ins only — imported by the stack scripts.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const MAX_SLOT = 47;
const SLUG_MAX = 40;
const SPEC_BRANCH = /^spec-(\d{2})([ab])?-/;

/**
 * @typedef {{ branch: string, isMainCheckout: boolean, commonDir: string, toplevel: string }} GitInfo
 * @typedef {{ server: number, web: number, fakes: [number, number, number, number] }} Ports
 * @typedef {{
 *   database: string,
 *   testDatabase: string,
 *   redisDb: number,
 *   redisPrefix: string,
 *   channelPrefix: string,
 *   mailAddress: (name: string) => string,
 * }} Isolation
 * @typedef {GitInfo & Isolation & { slot: number, slug: string, ports: Ports }} Worktree
 */

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Branch and checkout facts of the git tree that contains `cwd`.
 * @param {string} cwd
 * @returns {GitInfo}
 */
export function gitInfo(cwd) {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const gitDir = path.resolve(cwd, git(cwd, ['rev-parse', '--git-dir']));
  const commonDir = path.resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']));
  const toplevel = path.resolve(git(cwd, ['rev-parse', '--show-toplevel']));
  return { branch, isMainCheckout: samePath(gitDir, commonDir), commonDir, toplevel };
}

/**
 * @param {string} a
 * @param {string} b
 */
function samePath(a, b) {
  const norm = (/** @type {string} */ p) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/**
 * Slot of a worktree: `T2F_SLOT` wins, the main checkout is 0, `spec-NN[a|b]-*` maps to 2·NN (+1 for b).
 * @param {{ branch: string, isMainCheckout: boolean, envSlot?: string | undefined }} input
 * @returns {number}
 */
export function slotFor({ branch, isMainCheckout, envSlot }) {
  if (envSlot !== undefined && envSlot !== '') {
    if (!/^\d{1,2}$/.test(envSlot) || Number(envSlot) > MAX_SLOT) {
      throw new Error(`T2F_SLOT must be an integer 0-${MAX_SLOT}`);
    }
    return Number(envSlot);
  }
  if (isMainCheckout) return 0;
  const m = SPEC_BRANCH.exec(branch);
  if (m) {
    const nn = Number(m[1]);
    if (nn >= 1 && nn <= 23) return 2 * nn + (m[2] === 'b' ? 1 : 0);
  }
  throw new Error(`branch "${branch}" matches no spec-NN[a|b]-* pattern; set T2F_SLOT=<0-${MAX_SLOT}>`);
}

/**
 * @param {number} slot
 * @returns {Ports}
 */
export function portsFor(slot) {
  const base = 4000 + 10 * slot;
  return { server: base, web: base + 1, fakes: [base + 2, base + 3, base + 4, base + 5] };
}

/**
 * Normalised worktree slug: only `[a-z0-9_]`, at most 40 characters.
 * @param {{ branch: string, isMainCheckout: boolean }} input
 * @returns {string}
 */
export function slugFor({ branch, isMainCheckout }) {
  if (isMainCheckout) return 'main';
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/_+$/g, '');
  if (slug === '') throw new Error(`branch "${branch}" gives an empty slug`);
  return slug;
}

/**
 * @param {{ slug: string, slot: number }} input
 * @returns {Isolation}
 */
export function isolationFor({ slug, slot }) {
  return {
    database: `t2f_${slug}`,
    testDatabase: `t2f_${slug}_test`,
    redisDb: slot,
    redisPrefix: `t2f:${slug}:`,
    channelPrefix: `${slug}_`,
    mailAddress: (name) => `${name}+${slug}@example.com`,
  };
}

/**
 * The single entry used by the scripts.
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {Worktree}
 */
export function resolveWorktree(cwd, env) {
  const info = gitInfo(cwd);
  const slot = slotFor({ branch: info.branch, isMainCheckout: info.isMainCheckout, envSlot: env.T2F_SLOT });
  const slug = slugFor(info);
  return { ...info, slot, slug, ports: portsFor(slot), ...isolationFor({ slug, slot }) };
}
