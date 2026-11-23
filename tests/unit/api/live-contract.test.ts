import { getService } from '@/lib/api/services';
import { describeDomain } from '../../contract/live.suite';

describeDomain('live (sim)', () => getService('live'));
