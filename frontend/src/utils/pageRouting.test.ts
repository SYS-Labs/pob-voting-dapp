import { describe, expect, it } from 'vitest';
import { getPageFromPath } from './pageRouting';

describe('getPageFromPath', () => {
  it('classifies known frontend routes', () => {
    expect(getPageFromPath('/')).toBe('iterations');
    expect(getPageFromPath('/join')).toBe('join');
    expect(getPageFromPath('/iteration/4')).toBe('iteration');
    expect(getPageFromPath('/iteration/4/details/edit')).toBe('iteration');
    expect(getPageFromPath('/iteration/4/project/0x123')).toBe('project');
    expect(getPageFromPath('/iteration/4/project/0x123/edit')).toBe('project');
    expect(getPageFromPath('/privacy')).toBe('privacy');
    expect(getPageFromPath('/terms')).toBe('terms');
  });

  it('classifies unknown or malformed routes as not found', () => {
    expect(getPageFromPath('/missing')).toBe('not-found');
    expect(getPageFromPath('/iteration/nope')).toBe('not-found');
    expect(getPageFromPath('/profile')).toBe('not-found');
    expect(getPageFromPath('/get-address/extra')).toBe('not-found');
  });
});
