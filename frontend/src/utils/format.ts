import { ethers } from 'ethers';

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatDate(timestamp?: number): string {
  if (!timestamp) return 'TBA';
  return new Date(timestamp * 1000).toLocaleString();
}

export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value) return null;
  if (value === ethers.ZeroAddress) return null;
  return value;
}
