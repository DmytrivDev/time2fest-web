// @ts-check
// Підставні порти звірки цілі (F3): DNS і `ssh -G` без мережі й без справжнього ssh. Типово кожне ім’я веде на
// документаційну адресу 203.0.113.10, а `ssh -G` повертає саму ціль.

/**
 * @param {{ addresses?: Record<string, string[]>, sshHostnames?: Record<string, string> }} [o] підміни для окремих імен
 * @returns {{ lookupHost: (host: string) => Promise<string[]>, sshHostname: (host: string) => Promise<string>, lookups: string[] }}
 */
export function fakeTarget(o = {}) {
  /** @type {string[]} */
  const lookups = [];
  return {
    lookups,
    lookupHost: async (host) => {
      lookups.push(host);
      return o.addresses?.[host] ?? ['203.0.113.10'];
    },
    sshHostname: async (host) => o.sshHostnames?.[host] ?? host,
  };
}

/** Порти для `main(argv, { ...FAKE_TARGET })`. */
export const FAKE_TARGET = (() => {
  const { lookupHost, sshHostname } = fakeTarget();
  return { lookupHost, sshHostname };
})();
