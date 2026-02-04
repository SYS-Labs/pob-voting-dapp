import { writable, derived } from 'svelte/store';

// ============================================================================
// Store
// ============================================================================

export const openAdminSection = writable<string | null>('activate');

// ============================================================================
// Actions
// ============================================================================

export function toggleAdminSection(sectionId: string): void {
  openAdminSection.update(current => current === sectionId ? null : sectionId);
}
