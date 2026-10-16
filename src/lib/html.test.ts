import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizeInline } from './html';
import { safeHref } from './url';

const ALLOWED_TAGS = new Set(['B', 'I', 'U', 'S', 'CODE', 'A', 'SPAN', 'BR']);

/** Throws when sanitized output contains anything outside the inline subset. */
export function assertInlineSubset(html: string) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('*').forEach(el => {
    expect(ALLOWED_TAGS.has(el.tagName), `tag ${el.tagName} in ${html}`).toBe(true);
    for (const attr of Array.from(el.attributes)) {
      if (el.tagName === 'A' && attr.name === 'href') {
        expect(safeHref(attr.value), `href ${attr.value}`).toBe(attr.value);
      } else if (el.tagName === 'SPAN' && attr.name === 'class') {
        for (const c of attr.value.split(/\s+/)) expect(c).toMatch(/^(c|bg)-[a-z]+$/);
      } else {
        throw new Error(`attribute ${attr.name} on ${el.tagName} in ${html}`);
      }
    }
  });
}

const CORPUS = [
  '<img src=x onerror=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<svg onload=alert(1)><a href="javascript:alert(1)">x</a></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#x6A;avascript&colon;alert(1)">x</a>',
  '<a href=" javascript:alert(1)">x</a>',
  '<a href="java&#9;script:alert(1)">x</a>',
  '<a href="JAVASCRIPT:alert(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<a href="//evil.example">x</a>',
  '<a href="/\\evil.example">x</a>',
  '<a href="https://ok.example"><a href="javascript:alert(1)">nested</a></a>',
  '<b style="background:url(javascript:alert(1))" onclick="alert(1)">bold</b>',
  '<span class="c-red onerror" style="color:red" onmouseover="alert(1)">t</span>',
  '<span class="c-red bg-blue x-evil">t</span>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<object data="javascript:alert(1)"></object><embed src="x">',
  '<style>*{background:url(https://evil/x)}</style>text',
  '<template><img src=x onerror=alert(1)></template>',
  '<details open ontoggle=alert(1)>x</details>',
  '<input autofocus onfocus=alert(1)>',
  '<video><source onerror=alert(1)></video>',
  '<a href="https://x.example" target="_top" rel="opener" onclick="alert(1)">link</a>',
  '<font color="#010106" face="nc-code">colored</font>',
  '<div>line<div>two</div></div><p>three</p>',
  '<<img src=x onerror=alert(1)>',
  '<scr<script>ipt>alert(1)</script>',
  '&lt;img src=x onerror=alert(1)&gt;',
  '<b><i><u><s><code>deep</code></s></u></i></b>',
  '<a href="mailto:a@b.c">m</a><a href="tel:+1">t</a><a href="#/p/abc">p</a>',
];

describe('sanitizeInline corpus', () => {
  it('keeps only the inline subset for every hostile input', () => {
    for (const input of CORPUS) assertInlineSubset(sanitizeInline(input));
  });

  it('keeps legitimate formatting', () => {
    expect(sanitizeInline('<b>a</b> <a href="https://x.example">l</a>')).toBe('<b>a</b> <a href="https://x.example">l</a>');
    expect(sanitizeInline('<span class="c-red bg-blue">t</span>')).toBe('<span class="c-red bg-blue">t</span>');
    expect(sanitizeInline('<a href="//evil.example">x</a>')).toBe('<a>x</a>');
    expect(sanitizeInline('&lt;img src=x onerror=1&gt;')).toBe('&lt;img src=x onerror=1&gt;');
  });

  it('is idempotent on the corpus', () => {
    for (const input of CORPUS) {
      const once = sanitizeInline(input);
      expect(sanitizeInline(once), input).toBe(once);
    }
  });

  it('is idempotent and safe on random tag soup', () => {
    const parts = ['<b>', '</b>', '<i>', '</i>', '<a href="https://x.y">', '<a href="javascript:1">', '</a>', '<span class="c-red">', '</span>',
      '<br>', '<div>', '</div>', '<img src=x onerror=1>', '<svg>', '</svg>', '<math>', '<style>', '</style>', 'text', ' ', '&amp;', '&lt;', '"', "'", '<code>', '</code>'];
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 400; n++) {
      let s = '';
      const len = 1 + Math.floor(rnd() * 14);
      for (let i = 0; i < len; i++) s += parts[Math.floor(rnd() * parts.length)];
      const once = sanitizeInline(s);
      assertInlineSubset(once);
      expect(sanitizeInline(once), s).toBe(once);
    }
  });
});

describe('htmlToText', () => {
  it('extracts text without creating live elements', () => {
    expect(htmlToText('a<br>b')).toBe('a\nb');
    expect(htmlToText('&lt;img src=x onerror=1&gt;')).toBe('<img src=x onerror=1>');
    expect(htmlToText('<img src=x onerror="window.__pwned=1">')).toBe('');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
