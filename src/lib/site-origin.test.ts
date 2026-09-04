import { describe, expect, it } from 'vitest';
import { siteOrigin } from './site-origin';

describe('public site origin', () => {
  it('requires an explicit production origin while allowing local development', () => {
    for (const value of [undefined, '', '  '])
      expect(() => siteOrigin(value, true)).toThrow('SITE_URL is required');
    expect(siteOrigin(undefined, false)).toBe('http://localhost:5173');
  });

  it('normalizes valid origins including explicit local browser-test origins', () => {
    expect(siteOrigin(' https://docs.example/ ', true)).toBe('https://docs.example');
    expect(siteOrigin('http://localhost:4173', true)).toBe('http://localhost:4173');
  });

  it('rejects relative URLs and values that cannot be canonical origins', () => {
    for (const value of [
      '/docs',
      'docs.example',
      'ftp://docs.example',
      'https://user:secret@docs.example',
      'https://docs.example/docs',
      'https://docs.example/?preview=1',
      'https://docs.example/#docs',
    ]) {
      expect(() => siteOrigin(value, true)).toThrow('SITE_URL');
    }
  });
});
