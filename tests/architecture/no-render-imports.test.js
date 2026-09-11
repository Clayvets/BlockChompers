import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Enforces the layering rule: the logic layer must be runnable (and testable) without Three.js,
 * a DOM, a clock or randomness. Comments are stripped before matching so docs may mention these.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PURE_DIRS = ['src/core', 'src/config'];

const FORBIDDEN = [
  { name: "static import of 'three'", re: /from\s+['"]three(\/|['"])/ },
  { name: "dynamic import('three')", re: /import\s*\(\s*['"]three/ },
  { name: 'window', re: /\bwindow\b/ },
  { name: 'document', re: /\bdocument\b/ },
  { name: 'navigator', re: /\bnavigator\b/ },
  { name: 'requestAnimationFrame', re: /\brequestAnimationFrame\b/ },
  { name: 'performance', re: /\bperformance\b/ },
  { name: 'Math.random', re: /Math\.random/ },
  { name: 'Date.now / new Date', re: /\bDate\.now\b|\bnew\s+Date\b/ },
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith('.js') ? [full] : [];
  });
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('layering: src/core and src/config are pure', () => {
  const files = PURE_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

  it('finds the pure modules', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${relative(ROOT, file).split(sep).join('/')} has no Three.js / DOM / clock / randomness`, () => {
      const code = stripComments(readFileSync(file, 'utf8'));
      const hits = FORBIDDEN.filter(({ re }) => re.test(code)).map(({ name }) => name);
      expect(hits).toEqual([]);
    });
  }
});
