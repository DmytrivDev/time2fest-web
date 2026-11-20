import * as migration_20261116_221920_initial from './20261116_221920_initial';
import * as migration_20261117_133657_admin_catalog from './20261117_133657_admin_catalog';
import * as migration_20261118_102304_clock_server from './20261118_102304_clock_server';
import * as migration_20261119_212709_moderation from './20261119_212709_moderation';

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
    name: '20261119_212709_moderation'
  },
];
