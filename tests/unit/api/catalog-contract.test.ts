import { getService } from '@/lib/api/services';
import { describeDomain } from '../../contract/catalog.suite';

describeDomain('catalog (sim)', () => getService('catalog'));
