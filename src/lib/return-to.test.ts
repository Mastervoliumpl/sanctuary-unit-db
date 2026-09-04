import { describe, expect, it } from 'vitest';
import { DEFAULT_RETURN_TO, safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('keeps same-site paths, including query strings', () => {
    expect(safeReturnTo('/units/karganeth')).toBe('/units/karganeth');
    expect(safeReturnTo('/compare?a=x&b=y')).toBe('/compare?a=x&b=y');
    expect(safeReturnTo('/')).toBe('/');
  });

  it('falls back to the ladder when nothing was given', () => {
    expect(safeReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('')).toBe(DEFAULT_RETURN_TO);
  });

  it('refuses anything that could leave the origin', () => {
    expect(safeReturnTo('https://evil.example/')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('//evil.example/')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('/\\evil.example')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('javascript:alert(1)')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('/x\r\nSet-Cookie: a=b')).toBe(DEFAULT_RETURN_TO);
  });

  it('refuses bouncing back into the api', () => {
    expect(safeReturnTo('/api/auth/steam')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('/api')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('/apiary')).toBe('/apiary');
  });
});
