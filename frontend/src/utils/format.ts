import { ethers } from 'ethers';
import { NETWORKS } from '~/constants/networks';

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatContractAddress(address: string): string {
  return `${address.slice(0, 7)}...${address.slice(-5)}`;
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

export function generateAvatarImage(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Curated palette based on project colors and complementary tones
  // Syscoin Orange, Blue, Green, Purple, Pink, Teal
  const palette = [
    '#f7931a', // Primary
    '#3b82f6', // Blue
    '#10b981', // Emerald
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#06b6d4', // Cyan
  ];

  const colorIndex = Math.abs(hash) % palette.length;
  const primaryColor = palette[colorIndex];
  // Darker shade for pattern/gradient
  // Since we don't have a color manipulator lib, we'll just use black with opacity overlay

  const patternType = Math.abs(hash >> 8) % 4; // 0: Solid/Gradient, 1: Stripes, 2: Dots, 3: Radial

  // We construct a simple SVG Data URI
  let svgContent = '';
  const size = 100;

  switch (patternType) {
    case 0: // Linear Gradient
      svgContent = `
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${primaryColor};stop-opacity:0.6" />
          </linearGradient>
        </defs>
        <rect width="${size}" height="${size}" fill="url(#grad)" />
      `;
      break;
    case 1: // Stripes
      svgContent = `
        <defs>
          <pattern id="stripes" width="20" height="20" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <rect width="10" height="20" fill="${primaryColor}" />
            <rect x="10" width="10" height="20" fill="${primaryColor}" fill-opacity="0.7" />
          </pattern>
        </defs>
        <rect width="${size}" height="${size}" fill="url(#stripes)" />
      `;
      break;
    case 2: // Dots
      svgContent = `
        <defs>
          <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect width="20" height="20" fill="${primaryColor}" />
            <circle cx="10" cy="10" r="4" fill="white" fill-opacity="0.2" />
          </pattern>
        </defs>
        <rect width="${size}" height="${size}" fill="url(#dots)" />
      `;
      break;
    case 3: // Radial Gradient
      svgContent = `
        <defs>
          <radialGradient id="grad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${primaryColor};stop-opacity:0.5" />
          </radialGradient>
        </defs>
        <rect width="${size}" height="${size}" fill="rgb(30,30,30)" />
        <rect width="${size}" height="${size}" fill="url(#grad)" />
      `;
      break;
  }

  // Encode SVG for Data URI
  const encodedSvg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${svgContent}</svg>`);
  return `data:image/svg+xml;charset=utf-8,${encodedSvg}`;
}

/**
 * Format transaction hash
 */
export function formatTxHash(hash: string): string {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

/**
 * Get block explorer link for transaction
 */
export function getExplorerTxLink(chainId: number, txHash: string): string {
  const network = NETWORKS[chainId];
  const explorerUrl = network?.explorerUrl;

  if (!explorerUrl || explorerUrl === '#') return '#';
  return `${explorerUrl}/tx/${txHash}`;
}

/**
 * Validate YouTube URL
 */
export function isValidYouTubeUrl(url: string): boolean {
  const patterns = [
    /^https?:\/\/(www\.)?youtu\.be\/.+$/,
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=.+$/,
  ];
  return patterns.some(pattern => pattern.test(url));
}

/**
 * Validate generic URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
