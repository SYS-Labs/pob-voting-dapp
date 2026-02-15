/**
 * Hashing utilities for content verification
 */

import crypto from 'crypto';

function sha256(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');
}

/**
 * Compute content hash with 0x prefix for blockchain
 */
export function contentHash(content: string): string {
  return '0x' + sha256(content);
}
