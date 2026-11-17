import * as migration_20261116_221920_initial from './20261116_221920_initial';
import * as migration_20261117_103807_spec04_wip_p3 from './20261117_103807_spec04_wip_p3';

export const migrations = [
  {
    up: migration_20261116_221920_initial.up,
    down: migration_20261116_221920_initial.down,
    name: '20261116_221920_initial',
  },
  {
    up: migration_20261117_103807_spec04_wip_p3.up,
    down: migration_20261117_103807_spec04_wip_p3.down,
    name: '20261117_103807_spec04_wip_p3'
  },
];
