import { beforeEach } from 'vitest';
import { getService } from '@/lib/api/services';
import { resetSimSiteForTest } from '@/lib/api/sim/site';
import { describeDomain } from '../../contract/site.suite';

beforeEach(() => resetSimSiteForTest());

describeDomain('site (sim)', () => getService('site'));
