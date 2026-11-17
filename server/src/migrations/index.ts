import * as migration_20261116_221920_initial from './20261116_221920_initial';
import * as migration_20261117_103807_spec04_wip_p3 from './20261117_103807_spec04_wip_p3';
import * as migration_20261117_110521_spec04_wip_p4 from './20261117_110521_spec04_wip_p4';
import * as migration_20261117_111802_spec04_wip_p5 from './20261117_111802_spec04_wip_p5';
import * as migration_20261117_122730_spec04_wip_p8 from './20261117_122730_spec04_wip_p8';
import * as migration_20261117_125635_spec04_wip_p9 from './20261117_125635_spec04_wip_p9';

export const migrations = [
  {
    up: migration_20261116_221920_initial.up,
    down: migration_20261116_221920_initial.down,
    name: '20261116_221920_initial',
  },
  {
    up: migration_20261117_103807_spec04_wip_p3.up,
    down: migration_20261117_103807_spec04_wip_p3.down,
    name: '20261117_103807_spec04_wip_p3',
  },
  {
    up: migration_20261117_110521_spec04_wip_p4.up,
    down: migration_20261117_110521_spec04_wip_p4.down,
    name: '20261117_110521_spec04_wip_p4',
  },
  {
    up: migration_20261117_111802_spec04_wip_p5.up,
    down: migration_20261117_111802_spec04_wip_p5.down,
    name: '20261117_111802_spec04_wip_p5',
  },
  {
    up: migration_20261117_122730_spec04_wip_p8.up,
    down: migration_20261117_122730_spec04_wip_p8.down,
    name: '20261117_122730_spec04_wip_p8',
  },
  {
    up: migration_20261117_125635_spec04_wip_p9.up,
    down: migration_20261117_125635_spec04_wip_p9.down,
    name: '20261117_125635_spec04_wip_p9'
  },
];
