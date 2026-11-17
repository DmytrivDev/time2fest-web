// @ts-check
// Операції розгортання: `node infra/ops/ops.mjs <deploy|rollback|bootstrap|edge-secret|move-domain|capacity> …`.
// Нуль залежностей. Підкоманди підключаються по фазах; до того друкують `not implemented`.
import { fileURLToPath } from 'node:url';

const SUBCOMMANDS = ['deploy', 'rollback', 'bootstrap', 'edge-secret', 'move-domain', 'capacity'];

/**
 * @param {string[]} argv
 * @param {{ out?: (line: string) => void }} [deps]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, deps = {}) {
  const out = deps.out ?? ((/** @type {string} */ line) => console.log(line));
  const [sub] = argv;
  if (!sub || !SUBCOMMANDS.includes(sub)) {
    out(`usage: ops <${SUBCOMMANDS.join('|')}> …`);
    return 2;
  }
  out(`${sub}: not implemented`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
