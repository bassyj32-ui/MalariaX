import { describe, expect, it } from 'vitest';
import en from './en.json';
import am from './am.json';

/** JSON resources may hold arrays (action lists, danger signs), so the walk has
 *  to treat them as leaf values rather than recursing into them. */
type Tree = { [k: string]: string | string[] | Tree };

const flatten = (obj: Tree, prefix = ''): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) continue; // asserted separately
    if (typeof v === 'string') out.set(path, v);
    else for (const [p, val] of flatten(v, path)) out.set(p, val);
  }
  return out;
};

const enTree = en as unknown as Tree;
const amTree = am as unknown as Tree;
const enFlat = flatten(enTree);
const amFlat = flatten(amTree);

describe('i18n key parity', () => {
  it('has the same number of keys in both languages', () => {
    expect(amFlat.size).toBe(enFlat.size);
  });

  it('has no English key missing from Amharic', () => {
    const missing = [...enFlat.keys()].filter((k) => !amFlat.has(k));
    expect(missing, `missing in am: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no Amharic key missing from English', () => {
    const extra = [...amFlat.keys()].filter((k) => !enFlat.has(k));
    expect(extra, `missing in en: ${extra.join(', ')}`).toEqual([]);
  });

  it('has no empty strings in either language', () => {
    for (const [k, v] of enFlat) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of amFlat) expect(v.trim(), `am ${k}`).not.toBe('');
  });
});

describe('i18n interpolation placeholders', () => {
  const placeholders = (s: string): string[] =>
    [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  it('uses identical placeholder names in both languages', () => {
    for (const [k, enVal] of enFlat) {
      const amVal = amFlat.get(k)!;
      expect(placeholders(amVal), `placeholders differ for "${k}"`).toEqual(placeholders(enVal));
    }
  });
});

const actionsOf = (tree: Tree, level: string): string[] => {
  const levels = tree.result as Tree;
  const entry = levels.levels as Tree;
  return (entry[level] as Tree).actions as string[];
};

describe('i18n content safety', () => {
  it('has no Unicode replacement characters from bad encoding', () => {
    for (const [k, v] of amFlat) {
      expect(v.includes('\uFFFD'), `am "${k}" contains U+FFFD`).toBe(false);
    }
    for (const [k, v] of enFlat) {
      expect(v.includes('\uFFFD'), `en "${k}" contains U+FFFD`).toBe(false);
    }
  });

  it('actually contains Ethiopic script in the Amharic resource', () => {
    // Guards against a silent fallback to English left in place of translation.
    const ethiopic = /\p{Script=Ethiopic}/u;
    const untranslated = [...amFlat].filter(([, v]) => !ethiopic.test(v));
    expect(untranslated.length).toBeGreaterThan(0); // brand names etc. are expected
    // The vast majority must genuinely be Amharic.
    const ratio = 1 - untranslated.length / amFlat.size;
    expect(ratio, 'less than 70% of Amharic strings contain Ethiopic script').toBeGreaterThan(0.7);
  });

  it('carries the four risk levels in both languages', () => {
    const levels = ['low', 'moderate', 'high', 'emergency'] as const;
    for (const level of levels) {
      expect(enFlat.has(`result.levels.${level}.label`), `en ${level}`).toBe(true);
      expect(amFlat.has(`result.levels.${level}.label`), `am ${level}`).toBe(true);
      // Every level must have exactly three concrete, actionable steps.
      const list = actionsOf(enTree, level);
      expect(list.length, `${level} action count`).toBe(3);
      for (const action of list) expect(action.trim(), `${level} action`).not.toBe('');
      const amList = actionsOf(amTree, level);
      expect(amList.length, `${level} am action count`).toBe(3);
    }
  });

  it('carries every danger sign in the result panel', () => {
    const enFlags = (enTree.result as Tree).redFlags as string[];
    const amFlags = (amTree.result as Tree).redFlags as string[];
    expect(enFlags.length).toBeGreaterThanOrEqual(6);
    expect(amFlags.length).toBe(enFlags.length);
    for (let i = 0; i < enFlags.length; i++) {
      expect(enFlags[i]!.trim()).not.toBe('');
      expect(amFlags[i]!.trim()).not.toBe('');
      expect(amFlags[i]).not.toBe(enFlags[i]);
    }
  });
});