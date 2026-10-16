import { beforeEach, describe, expect, it } from 'vitest';
import { htmlToMarkdown, inlineMarkdownToHtml, textToHtml } from './html';
import { importMarkdownAsPage, markdownToBlocks, pageToMarkdown } from './exporter';
import { getDoc } from '../store/store';
import type { Block } from '../store/types';

/** Serializes through the DOM so equivalent markup compares equal. */
function norm(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.innerHTML;
}

function roundTrip(html: string): string {
  return norm(inlineMarkdownToHtml(htmlToMarkdown(html)));
}

describe('inline markdown round trip', () => {
  const SAME = [
    'plain text',
    '<b>bold</b> and <i>italic</i> and <s>gone</s>',
    'a<i>b</i>c',
    '<code>code</code> tail',
    '<b><i>both</i></b>',
    '<i><b>both</b></i>',
    '<i>a</i><b>b</b>',
    '<b>a</b><i>b</i>',
    '<b>ab</b>',
    '<u>underlined</u> text',
    '<b><u>bold underline</u></b>',
    '<span class="c-red">red</span> and <span class="c-blue bg-yellow">blue on yellow</span>',
    '<a href="https://example.com/a">link</a>',
    '<a href="https://example.com/a_(b)">paren url</a>',
    '<a href="https://example.com/a">a <b>bold</b> link</a>',
    '<a href="#/p/abc123">in app</a>',
    'line one<br>line two',
    '<b>bold</b><br>next',
  ];
  for (const html of SAME) {
    it(`keeps ${html}`, () => {
      expect(roundTrip(html)).toBe(norm(html));
    });
  }

  const LITERAL = [
    '*word*',
    '**word**',
    '_word_ and snake_case_name',
    '`tick`',
    '[not a link](https://example.com)',
    '~~not struck~~',
    'a \\ backslash',
    '2 * 3 * 4',
    '# not a heading',
    '## nor this',
    '> not a quote',
    '- not a bullet',
    '+ not a bullet',
    '1. not a list',
    '2) nor this',
    '---',
    '<u>not underlined</u>',
    '<span class="c-red">not colored</span>',
    '<br> and <b>',
    'a & b < c > d "q"',
    '#hashtag stays',
    'tilde ~ alone',
  ];
  for (const text of LITERAL) {
    it(`keeps literal text ${JSON.stringify(text)}`, () => {
      expect(roundTrip(textToHtml(text))).toBe(norm(textToHtml(text)));
    });
  }

  it('escapes inside formatting too', () => {
    const html = '<b>*a*</b> <i>_b_</i> <a href="https://example.com/x">[c]</a>';
    expect(roundTrip(html)).toBe(norm(html));
  });

  it('exports the documented underline and color forms', () => {
    expect(htmlToMarkdown('<u>x</u>')).toBe('<u>x</u>');
    expect(htmlToMarkdown('<span class="c-red">x</span>')).toBe('<span class="c-red">x</span>');
    expect(htmlToMarkdown('<span class="evil" onclick="x">x</span>')).toBe('x');
  });

  it('escapes a closing paren in a url', () => {
    expect(htmlToMarkdown('<a href="https://e.com/a(1)">x</a>')).toBe('[x](https://e.com/a\\(1\\))');
  });

  it('reads plain markdown written by other tools', () => {
    expect(inlineMarkdownToHtml('**b** *i* ~~s~~ `c` [l](https://e.com)')).toBe('<b>b</b> <i>i</i> <s>s</s> <code>c</code> <a href="https://e.com">l</a>');
    expect(inlineMarkdownToHtml('__b__ _i_')).toBe('<b>b</b> <i>i</i>');
    expect(inlineMarkdownToHtml('***x***')).toBe('<b><i>x</i></b>');
    expect(inlineMarkdownToHtml('[x](javascript:alert(1))')).not.toContain('<a');
  });
});

function texts(ids: string[]): string[] {
  return ids.map(id => getDoc().blocks[id]).map(b => `${b.type}:${b.html}:${(b.children || []).length}`);
}

function tree(ids: string[]): unknown[] {
  const d = getDoc();
  return ids.map(id => {
    const b: Block = d.blocks[id];
    return { type: b.type, html: b.html, checked: b.checked, children: tree(b.children) };
  });
}

describe('markdown pages', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps nested list depth when importing as a page', () => {
    const id = importMarkdownAsPage('t.md', '# T\n\n- a\n  - b\n    - c\n- d\n\n1. one\n2. two');
    const page = getDoc().pages[id];
    expect(page.content).toHaveLength(4);
    const a = getDoc().blocks[page.content[0]];
    expect(a.children).toHaveLength(1);
    const b = getDoc().blocks[a.children[0]];
    expect(b.html).toBe('b');
    expect(getDoc().blocks[b.children[0]].html).toBe('c');
  });

  it('understands 4 space and tab indents too', () => {
    const specs = markdownToBlocks('- a\n    - b\n        - c\n- d\n\t- e') as Array<{ depth?: number }>;
    expect(specs.map(s => s.depth)).toEqual([0, 1, 2, 0, 1]);
  });

  it('round trips a page through export and import', () => {
    const md = [
      '# Title with \\*stars\\*',
      '',
      '## Sub',
      '',
      'Some **bold** and <u>underlined</u> and <span class="c-red">red</span> text',
      '',
      '- [ ] open',
      '- [x] done',
      '- item',
      '    - nested',
      '        - deeper',
      '1. one',
      '2. two',
      '',
      '> a quote',
      '',
      '\\# not a heading',
      '\\- not a bullet',
      '',
      '```ts',
      'const a = `x` * 2;',
      '```',
      '',
      '---',
    ].join('\n');
    const first = importMarkdownAsPage('t.md', md);
    const exported = pageToMarkdown(first);
    const second = importMarkdownAsPage('t.md', exported);
    expect(tree(getDoc().pages[second].content)).toEqual(tree(getDoc().pages[first].content));
    expect(getDoc().pages[second].title).toBe(getDoc().pages[first].title);
    expect(getDoc().pages[first].title).toBe('Title with *stars*');
    // The literal lines stayed text.
    const kinds = texts(getDoc().pages[first].content);
    expect(kinds).toContain('text:# not a heading:0');
    expect(kinds).toContain('text:- not a bullet:0');
  });

  it('uses a longer fence when code contains one', () => {
    const id = importMarkdownAsPage('t.md', '````\n```\ninner\n```\n````');
    const out = pageToMarkdown(id);
    const again = importMarkdownAsPage('t.md', out);
    expect(tree(getDoc().pages[again].content)).toEqual(tree(getDoc().pages[id].content));
  });
});
