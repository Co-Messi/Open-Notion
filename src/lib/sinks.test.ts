import { describe, expect, it } from 'vitest';

/**
 * Source scan: stored html must never be parsed into a live element. Every innerHTML
 * assignment, dangerouslySetInnerHTML and similar sink in src/ is either a parse inside an
 * inert <template> (allowed automatically) or listed below with the reason it is safe.
 * A new sink fails this test until it is reviewed and added here.
 */

const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface Allowed {
  innerHTML?: number;
  dangerouslySetInnerHTML?: number;
  reason: string;
}

const ALLOWLIST: Record<string, Allowed> = {
  '/src/editor/Editable.tsx': { innerHTML: 2, reason: 'assigns sanitizeInline output (stored html is sanitized again before it reaches the DOM)' },
  '/src/editor/SlashMenu.tsx': { innerHTML: 1, reason: 'assigns sanitizeInline output after removing the /query text' },
  '/src/editor/TableBlock.tsx': { innerHTML: 1, reason: 'cells assign sanitizeInline output' },
  '/src/editor/CodeBlock.tsx': { dangerouslySetInnerHTML: 1, reason: 'highlight() escapes all source and only adds spans with fixed classes' },
  '/src/editor/PageView.tsx': { dangerouslySetInnerHTML: 1, reason: 'legacy comment html rendered through sanitizeInline' },
  '/src/components/Templates.tsx': { dangerouslySetInnerHTML: 6, reason: 'static template constants through escaped inlineMarkdownToHtml' },
};

/** Sinks that parse a string as html in the live document. */
const SINKS: Record<string, RegExp> = {
  outerHTML: /\.outerHTML\s*=(?!=)/g,
  insertAdjacentHTML: /\.insertAdjacentHTML\s*\(/g,
  createContextualFragment: /\.createContextualFragment\s*\(/g,
  documentWrite: /document\.write(ln)?\s*\(/g,
};

/** Identifiers created with document.createElement('<tag>') in a file, split by template or not. */
function createdElements(src: string) {
  const template = new Set<string>();
  const other = new Set<string>();
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*document\.createElement\(\s*['"`](\w+)['"`]\s*\)/g)) {
    (m[2].toLowerCase() === 'template' ? template : other).add(m[1]);
  }
  return { template, other };
}

const files = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path));

describe('html sink scan', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some(([p]) => p === '/src/editor/Editable.tsx')).toBe(true);
  });

  it('never parses html into a detached div or other live element', () => {
    const bad: string[] = [];
    for (const [path, src] of files) {
      const { other } = createdElements(src);
      for (const id of other) {
        if (new RegExp(`\\b${id}\\.innerHTML\\s*=(?!=)`).test(src)) bad.push(`${path}: ${id}.innerHTML = (createElement of a live element)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no unreviewed innerHTML assignment or dangerouslySetInnerHTML', () => {
    const problems: string[] = [];
    for (const [path, src] of files) {
      const { template } = createdElements(src);
      let inner = 0;
      for (const m of src.matchAll(/(\w+)\.innerHTML\s*=(?!=)/g)) if (!template.has(m[1])) inner++;
      const dangerous = (src.match(/dangerouslySetInnerHTML/g) || []).length;
      const allowed = ALLOWLIST[path] || { reason: '' };
      if (inner > (allowed.innerHTML || 0)) problems.push(`${path}: ${inner} innerHTML assignments, ${allowed.innerHTML || 0} reviewed`);
      if (dangerous > (allowed.dangerouslySetInnerHTML || 0)) problems.push(`${path}: ${dangerous} dangerouslySetInnerHTML, ${allowed.dangerouslySetInnerHTML || 0} reviewed`);
      for (const [name, re] of Object.entries(SINKS)) if (re.test(src)) problems.push(`${path}: uses ${name}`);
    }
    expect(problems).toEqual([]);
  });

  it('keeps the allowlist honest (every entry still exists)', () => {
    for (const path of Object.keys(ALLOWLIST)) expect(SOURCES[path], path).toBeTypeOf('string');
  });
});
