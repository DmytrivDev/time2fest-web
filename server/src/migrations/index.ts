import * as migration_20261116_221920_initial from './20261116_221920_initial';
import * as migration_20261117_133657_admin_catalog from './20261117_133657_admin_catalog';
import * as migration_20261118_102304_clock_server from './20261118_102304_clock_server';
import * as migration_20261119_212709_moderation from './20261119_212709_moderation';
import * as migration_20261120_165256_site_state from './20261120_165256_site_state';
import * as migration_20261123_105845_live from './20261123_105845_live';
import * as migration_20261124_011346_ops from './20261124_011346_ops';

export const migrations = [
  {
    up: migration_20261116_221920_initial.up,
    down: migration_20261116_221920_initial.down,
    name: '20261116_221920_initial',
  },
  {
    up: migration_20261117_133657_admin_catalog.up,
    down: migration_20261117_133657_admin_catalog.down,
    name: '20261117_133657_admin_catalog',
  },
  {
    up: migration_20261118_102304_clock_server.up,
    down: migration_20261118_102304_clock_server.down,
    name: '20261118_102304_clock_server',
  },
  {
    up: migration_20261119_212709_moderation.up,
    down: migration_20261119_212709_moderation.down,
    name: '20261119_212709_moderation',
  },
  {
    up: migration_20261120_165256_site_state.up,
    down: migration_20261120_165256_site_state.down,
    name: '20261120_165256_site_state',
  },
  {
    up: migration_20261123_105845_live.up,
    down: migration_20261123_105845_live.down,
    name: '20261123_105845_live',
  },
  {
    up: migration_20261124_011346_ops.up,
    down: migration_20261124_011346_ops.down,
    name: '20261124_011346_ops'
  },
];
