/** `data/stream-channels.json` (SPEC-21a AC-39) and the import registry order (AC-42). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamChannelsFileSchema } from '@time2fest/contracts/schemas';
import { describe, expect, it } from 'vitest';
import { channelsFromData } from '../../src/live/importChannels';
import { importRegistry } from '../../src/registries/imports';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/stream-channels.json');
const text = fs.readFileSync(file, 'utf8');
const raw = JSON.parse(text) as unknown;

describe('data/stream-channels.json', () => {
  it('passes the schema and holds 65 distinct channels and a blacklist section', () => {
    const parsed = StreamChannelsFileSchema.parse(raw);
    expect(parsed.channels).toHaveLength(65);
    expect(new Set(parsed.channels.map((c) => c.channelId)).size).toBe(65);
    expect(Array.isArray(parsed.blacklist)).toBe(true);
    expect(channelsFromData(raw).channels).toHaveLength(65);
  });

  it('holds no evidence links, summaries or watch urls', () => {
    for (const token of ['watch?v=', 'evidence', 'summary']) expect(text).not.toContain(token);
  });

  it('the import registry is catalog, chains, channels', () => {
    expect(importRegistry.map((r) => r.key)).toEqual(['catalog', 'chains', 'channels']);
  });
});
