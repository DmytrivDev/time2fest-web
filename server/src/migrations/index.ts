import * as migration_20261116_221920_initial from './20261116_221920_initial';

export const migrations = [
  {
    up: migration_20261116_221920_initial.up,
    down: migration_20261116_221920_initial.down,
    name: '20261116_221920_initial'
  },
];
