'use client';

/**
 * Тестові засоби шва для компонентів (машина часу): затримки й відмови сервісів (`lib/api/sim/faults`). У робочій
 * збірці — `undefined` (імітації в пакеті немає).
 */
import { faultControls } from '../services';

export const devFaults = () => faultControls();
