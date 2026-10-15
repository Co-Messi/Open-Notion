import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'on:diagnostics:v1';

/** A fresh diagnostics module, like a reloaded tab. */
async function fresh() {
  vi.resetModules();
  return import('./diagnostics');
}

beforeEach(() => {
  localStorage.clear();
});

describe('scrubMessage', () => {
  it('drops quoted text, including quotes nested inside quotes', async () => {
    const { scrubMessage } = await fresh();
    expect(scrubMessage(`Unexpected token 'x', "x{"a":"SECRET WORDS"}" is not valid JSON`)).toBe(`Unexpected token '…', "…" is not valid JSON`);
    expect(scrubMessage('Cannot render `SECRET`')).toBe('Cannot render `…`');
    // A quote without a partner: whatever follows could be content.
    expect(scrubMessage('bad "SECRET text')).toBe('bad "…');
    // Plain messages and a lone apostrophe stay readable.
    expect(scrubMessage('Storage full: removed the rolling safety copies')).toBe('Storage full: removed the rolling safety copies');
    expect(scrubMessage("Can't save")).toBe("Can't save");
    expect(scrubMessage('x'.repeat(5000))).toHaveLength(300);
  });
});

describe('diagnostics kept across a reload', () => {
  it('keeps the last 20 entries, scrubbed and size capped, and loads them in a new tab', async () => {
    const a = await fresh();
    for (let i = 0; i < 30; i++) a.recordError('test', new Error(`e${i} "SECRET ${i}"`));
    a.recordError('big', 'y'.repeat(10_000));
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toHaveLength(20);
    expect(JSON.stringify(stored)).not.toContain('SECRET');
    expect(localStorage.getItem(KEY)!.length).toBeLessThan(20 * 400);
    expect(stored[stored.length - 1]).toMatchObject({ source: 'big' });
    expect(stored[stored.length - 1].message).toHaveLength(300);

    const b = await fresh();
    const loaded = b.getRecentErrors();
    expect(loaded).toHaveLength(20);
    expect(loaded[0].message).toBe('Error: e11 "…"');
    // New entries add to what was loaded, and the ring buffer still caps at 50.
    for (let i = 0; i < 40; i++) b.recordError('later', `n${i}`);
    expect(b.getRecentErrors()).toHaveLength(50);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(20);
  });

  it('ignores stored garbage and survives storage that refuses writes', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ at: 'x' }, null, 7, { at: 1, source: 's', message: 'm "SECRET"' }]));
    const d = await fresh();
    expect(d.getRecentErrors()).toEqual([{ at: 1, source: 's', message: 'm "…"' }]);
    localStorage.setItem(KEY, '{not json');
    const e = await fresh();
    expect(e.getRecentErrors()).toEqual([]);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => e.recordError('save', 'quota')).not.toThrow();
    expect(e.getRecentErrors()).toHaveLength(1);
    spy.mockRestore();
  });
});
