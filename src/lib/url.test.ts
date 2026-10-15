import { describe, expect, it, vi } from 'vitest';
import { isImageIcon, isImageRef, normalizeTypedLink, openExternal, safeCover, safeHref, safeIcon, safeImageSrc, safeLinkUrl } from './url';

const C = (n: number) => String.fromCharCode(n);

describe('safeLinkUrl', () => {
  it('allows outbound schemes', () => {
    for (const u of ['https://example.com', 'http://a.b/c?d=1#e', 'mailto:a@b.c', 'tel:+15550100', 'HTTPS://X.Y']) {
      expect(safeLinkUrl(u)).toBe(u);
    }
    expect(safeLinkUrl('  https://example.com  ')).toBe('https://example.com');
  });
  it('rejects scripts, data, protocol relative and tricks', () => {
    const bad = [
      'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'java' + C(9) + 'script:alert(1)',
      'java' + C(10) + 'script:alert(1)', C(1) + 'javascript:alert(1)', 'vbscript:x', 'data:text/html,<script>1</script>',
      'data:image/png;base64,AAAA', '//evil.example', '/\\evil.example', '\\\\evil.example', 'https:\\\\evil.example',
      'file:///etc/passwd', 'blob:https://x/y', '', '   ', 'example.com', '#/p/x', '/relative',
    ];
    for (const u of bad) expect(safeLinkUrl(u), u).toBeNull();
    expect(safeLinkUrl(42)).toBeNull();
    expect(safeLinkUrl(null)).toBeNull();
  });
});

describe('safeHref', () => {
  it('allows in app fragments and local paths', () => {
    expect(safeHref('#/p/abc')).toBe('#/p/abc');
    expect(safeHref('/app/')).toBe('/app/');
    expect(safeHref('https://x.example')).toBe('https://x.example');
  });
  it('rejects protocol relative and backslash hosts', () => {
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('/\\evil.example')).toBeNull();
    expect(safeHref('/a\\b')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
  });
});

describe('normalizeTypedLink', () => {
  it('adds https to bare hosts and keeps allowed schemes', () => {
    expect(normalizeTypedLink('example.com/x')).toBe('https://example.com/x');
    expect(normalizeTypedLink('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(normalizeTypedLink('javascript:alert(1)')).toBeNull();
    expect(normalizeTypedLink('//evil.example')).toBeNull();
  });
});

describe('images, covers and icons', () => {
  it('accepts image sources', () => {
    for (const u of ['https://x/y.png', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml;base64,PHN2Zz4=', 'blob:http://localhost/123', 'on-img:abc_123', '/covers/a.webp']) {
      expect(safeImageSrc(u), u).toBe(u);
    }
  });
  it('rejects non image sources', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml,<svg onload=alert(1)>', '//evil/x.png', 'on-img:../x', 'on-img:']) {
      expect(safeImageSrc(u), u).toBeNull();
    }
  });
  it('recognises image refs', () => {
    expect(isImageRef('on-img:a1')).toBe(true);
    expect(isImageRef('on-img:a b')).toBe(false);
  });
  it('accepts gradients and colors as covers but not CSS breakouts', () => {
    expect(safeCover('linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)')).toBe('linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)');
    expect(safeCover('#e6e5e3')).toBe('#e6e5e3');
    expect(safeCover('https://x/y.jpg')).toBe('https://x/y.jpg');
    expect(safeCover('red; background: url(https://evil/x)')).toBeNull();
    expect(safeCover('linear-gradient(red, blue), url(https://evil/x)')).toBeNull();
    expect(safeCover('expression(alert(1))')).toBeNull();
  });
  it('accepts emoji icons and image icons', () => {
    expect(safeIcon('👋')).toBe('👋');
    expect(safeIcon('👨‍👩‍👧')).toBe('👨‍👩‍👧');
    expect(safeIcon('on-img:abc')).toBe('on-img:abc');
    expect(safeIcon('<img src=x onerror=1>')).toBeNull();
    // Not an image, so it can only ever be rendered as React text.
    expect(isImageIcon('javascript:alert(1)')).toBe(false);
    expect(safeIcon('x'.repeat(40))).toBeNull();
  });
});

describe('openExternal', () => {
  it('opens only allowed URLs, without an opener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(openExternal('javascript:alert(1)')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(openExternal('https://example.com')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });
});
