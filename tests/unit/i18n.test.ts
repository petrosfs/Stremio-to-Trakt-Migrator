import { describe, expect, it } from 'vitest';
import { dictionaries, translate } from '../../src/i18n';

describe('i18n', () => {
  it('has the same keys in every language', () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries.el).sort());
  });
  it('no empty strings', () => {
    for (const d of Object.values(dictionaries)) for (const v of Object.values(d)) expect(v.trim()).not.toBe('');
  });
  it('replaces variables', () => {
    expect(translate('en', 'panel.itemsN', { n: 3 })).toBe('3 items');
    expect(translate('el', 'missing.key')).toBe('missing.key');
  });
});

describe('i18n coverage', () => {
  it('every literal key used in the source exists', async () => {
    const { readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk('src');
    const used = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9.]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/'(err\.[a-zA-Z]+)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in dictionaries.el));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(50);
  });
});
