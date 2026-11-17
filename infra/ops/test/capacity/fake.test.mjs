// @ts-check
import { createFakeProvider } from '../../lib/capacity/fake.mjs';
import { describeProvider } from './provider.contract.mjs';

describeProvider('fake', async (seed) => {
  const f = createFakeProvider({ nodes: seed });
  return { provider: f.provider, failNext: f.failNext };
});
