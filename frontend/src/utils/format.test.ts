import { describe, it, expect } from 'vitest';
import {
  formatAddress,
  formatContractAddress,
  formatDate,
  formatTxHash,
  isValidYouTubeUrl,
  isValidUrl,
  generateAvatarImage,
} from './format';

describe('formatAddress', () => {
  it('truncates an Ethereum address correctly', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    expect(formatAddress(address)).toBe('0x1234...5678');
  });

  it('handles various address formats', () => {
    expect(formatAddress('0xABCDEF1234567890abcdef1234567890ABCDEF12')).toBe('0xABCD...EF12');
  });
});

describe('formatContractAddress', () => {
  it('truncates a contract address with 7+5 format', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    expect(formatContractAddress(address)).toBe('0x12345...45678');
  });
});

describe('formatDate', () => {
  it('returns TBA for undefined timestamp', () => {
    expect(formatDate(undefined)).toBe('TBA');
  });

  it('returns TBA for zero timestamp', () => {
    expect(formatDate(0)).toBe('TBA');
  });

  it('formats a valid timestamp', () => {
    const timestamp = 1704067200; // 2024-01-01 00:00:00 UTC
    const result = formatDate(timestamp);
    expect(result).toContain('2024');
  });
});

describe('formatTxHash', () => {
  it('truncates transaction hash', () => {
    const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    expect(formatTxHash(hash)).toBe('0x1234...cdef');
  });
});

describe('isValidYouTubeUrl', () => {
  it('accepts valid youtu.be URLs', () => {
    expect(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isValidYouTubeUrl('http://youtu.be/dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts valid youtube.com URLs', () => {
    expect(isValidYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });

  it('rejects invalid URLs', () => {
    expect(isValidYouTubeUrl('https://vimeo.com/123456')).toBe(false);
    expect(isValidYouTubeUrl('not a url')).toBe(false);
    expect(isValidYouTubeUrl('')).toBe(false);
  });
});

describe('isValidUrl', () => {
  it('accepts valid URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://localhost:3000')).toBe(true);
    expect(isValidUrl('https://sub.domain.com/path?query=1')).toBe(true);
  });

  it('rejects invalid URLs', () => {
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl('ftp://')).toBe(false);
  });
});

describe('generateAvatarImage', () => {
  it('returns a data URI', () => {
    const result = generateAvatarImage('test-user');
    expect(result).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });

  it('returns consistent results for the same input', () => {
    const result1 = generateAvatarImage('consistent-user');
    const result2 = generateAvatarImage('consistent-user');
    expect(result1).toBe(result2);
  });

  it('returns different results for different inputs', () => {
    const result1 = generateAvatarImage('user1');
    const result2 = generateAvatarImage('user2');
    expect(result1).not.toBe(result2);
  });
});
