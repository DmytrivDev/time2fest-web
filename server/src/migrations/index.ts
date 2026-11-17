import * as migration_20261116_221920_initial from './20261116_221920_initial';
import * as migration_20261117_133657_admin_catalog from './20261117_133657_admin_catalog';

export const migrations = [
  {
    up: migration_20261116_221920_initial.up,
    down: migration_20261116_221920_initial.down,
    name: '20261116_221920_initial',
  },
  {
    up: migration_20261117_133657_admin_catalog.up,
    down: migration_20261117_133657_admin_catalog.down,
    name: '20261117_133657_admin_catalog'
  },
];
