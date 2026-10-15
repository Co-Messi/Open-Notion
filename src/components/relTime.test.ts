import { afterEach, describe, expect, it, vi } from 'vitest';
import { relTime } from './ui';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function withLanguage(lang: string) {
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(lang);
}

afterEach(() => vi.restoreAllMocks());

describe('relTime', () => {
  it('keeps the compact English labels', () => {
    withLanguage('en-US');
    const now = Date.now();
    expect(relTime(now - 5000)).toBe('Just now');
    expect(relTime(now - 5 * MIN - 1000)).toBe('5m ago');
    expect(relTime(now - 2 * HOUR - 1000)).toBe('2h ago');
    expect(relTime(now - 3 * DAY - 1000)).toBe('3d ago');
  });

  it('follows the browser language', () => {
    withLanguage('de-DE');
    const now = Date.now();
    expect(relTime(now - 3 * DAY - 1000)).toBe('vor 3 Tagen');
    expect(relTime(now - 5000)).toBe('jetzt');
  });

  it('falls back to a localized date after a week', () => {
    withLanguage('en-GB');
    const t = Date.now() - 30 * DAY;
    expect(relTime(t)).toBe(new Date(t).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' }));
  });

  it('survives an invalid language tag', () => {
    withLanguage('not a language');
    expect(() => relTime(Date.now() - 2 * HOUR - 1000)).not.toThrow();
  });
});
