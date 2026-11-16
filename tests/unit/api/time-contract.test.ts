import { onRequestGet } from '@/functions/api/time';
import { describeDomain } from '../../contract/time.suite';

describeDomain('time (sim)', () => onRequestGet());
