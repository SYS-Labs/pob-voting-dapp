/**
 * Hashing utilities for content verification
 */

import crypto from 'crypto';

/**
 * Compute SHA-256 hash of content
 */
export function sha256(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');
}

/**
 * Compute SHA-256 hash and return as bytes32 (0x-prefixed)
 */
export function sha256Bytes32(content: string): string {
  const hash = sha256(content);
  return '0x' + hash;
}

/**
 * Compute content hash with 0x prefix for blockchain (alias for sha256Bytes32)
 */
export function contentHash(content: string): string {
  return sha256Bytes32(content);
}

/**
 * Verify content matches hash
 */
export function verifyHash(content: string, hash: string): boolean {
  const computed = hash.startsWith('0x')
    ? sha256Bytes32(content)
    : sha256(content);
  return computed === hash;
}
