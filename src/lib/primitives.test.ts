import { describe, expect, it, vi } from 'vitest';
import { hasOwnId, isSafeId, own } from './own';
import { classifyStorageError, describeStorageFailure, storageGet, storageGetJson, storageSet } from './storage';
import { attrSel, cssEscape } from './dom';
import { getRecentErrors, recordError } from './diagnostics';
import { parseHash } from '../store/route';

describe('own and isSafeId', () => {
  const rec: Record<string, number> = { a: 1, b_2: 2 };
  it('never reads prototype members', () => {
    for (const k of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'prototype']) {
      expect(own(rec, k), k).toBeUndefined();
      expect(hasOwnId(rec, k), k).toBe(false);
    }
    expect(own(rec, 'a')).toBe(1);
    expect(own(rec, 7)).toBeUndefined();
  });
  it('validates id shape', () => {
    expect(isSafeId('abc_12-x')).toBe(true);
    for (const id of ['', 'constructor', '__proto__', 'prototype', 'a b', 'a"]', 'x'.repeat(129), 5, null]) expect(isSafeId(id), String(id)).toBe(false);
  });
});

describe('parseHash', () => {
  it('parses routes and rejects prototype keys', () => {
    expect(parseHash('#/p/abc123')).toEqual({ name: 'page', pageId: 'abc123' });
    expect(parseHash('#/p/abc123?b=x')).toEqual({ name: 'page', pageId: 'abc123' });
    for (const bad of ['#/p/constructor', '#/p/__proto__', '#/p/prototype', '#/p/%E0%A4%A', '#/p/a%22%5D', '#/p/']) {
      expect(parseHash(bad), bad).toEqual({ name: 'home' });
    }
    expect(parseHash('#/chat')).toEqual({ name: 'chat' });
    expect(parseHash('#/whatever')).toEqual({ name: 'home' });
  });
});

describe('storage helpers', () => {
  it('classifies quota and blocked errors', () => {
    expect(classifyStorageError(new DOMException('full', 'QuotaExceededError'))).toBe('quota');
    expect(classifyStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe('quota');
    expect(classifyStorageError(new DOMException('no', 'SecurityError'))).toBe('blocked');
    expect(classifyStorageError(new Error('x'))).toBe('unknown');
    expect(describeStorageFailure('blocked')).toMatch(/blocking/);
  });
  it('reports failures instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const r = storageSet('k', 'v');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('quota');
  });
  it('reads guarded and parses JSON with a fallback', () => {
    storageSet('j', '{bad');
    expect(storageGetJson('j', 7)).toBe(7);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('no', 'SecurityError');
    });
    expect(storageGet('j')).toBeNull();
  });
});

describe('cssEscape', () => {
  it('builds selectors that cannot be broken by ids', () => {
    document.body.innerHTML = '<div data-x="a&quot;]b"></div>';
    expect(() => document.querySelector(attrSel('data-x', 'a"]b'))).not.toThrow();
    expect(document.querySelector(attrSel('data-x', 'a"]b'))).not.toBeNull();
    expect(cssEscape('abc')).toBe('abc');
  });
});

describe('diagnostics ring buffer', () => {
  it('keeps the most recent entries', () => {
    for (let i = 0; i < 60; i++) recordError('test', new Error('e' + i));
    const all = getRecentErrors();
    expect(all.length).toBe(50);
    expect(all[all.length - 1].message).toBe('Error: e59');
  });
});
