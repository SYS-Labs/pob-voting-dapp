import { writable, derived } from 'svelte/store';
import type { Project } from '~/interfaces';

// ============================================================================
// Types
// ============================================================================

interface ModalsState {
  switchNetworkModalOpen: boolean;
  disconnectModalOpen: boolean;
  pendingRemovalVoter: string | null;
  pendingRemovalProject: Project | null;
  errorModalOpen: boolean;
  errorMessage: string | null;
}

// ============================================================================
// Store
// ============================================================================

const initialState: ModalsState = {
  switchNetworkModalOpen: false,
  disconnectModalOpen: false,
  pendingRemovalVoter: null,
  pendingRemovalProject: null,
  errorModalOpen: false,
  errorMessage: null,
};

export const modalsStore = writable<ModalsState>(initialState);

// Derived stores
export const switchNetworkModalOpen = derived(modalsStore, $m => $m.switchNetworkModalOpen);
export const disconnectModalOpen = derived(modalsStore, $m => $m.disconnectModalOpen);
export const pendingRemovalVoter = derived(modalsStore, $m => $m.pendingRemovalVoter);
export const pendingRemovalProject = derived(modalsStore, $m => $m.pendingRemovalProject);
export const errorModalOpen = derived(modalsStore, $m => $m.errorModalOpen);
export const errorMessage = derived(modalsStore, $m => $m.errorMessage);

// ============================================================================
// Actions
// ============================================================================

export function openSwitchNetworkModal(): void {
  modalsStore.update(s => ({ ...s, switchNetworkModalOpen: true }));
}

export function closeSwitchNetworkModal(): void {
  modalsStore.update(s => ({ ...s, switchNetworkModalOpen: false }));
}

export function openDisconnectModal(): void {
  modalsStore.update(s => ({ ...s, disconnectModalOpen: true }));
}

export function closeDisconnectModal(): void {
  modalsStore.update(s => ({ ...s, disconnectModalOpen: false }));
}

export function setPendingRemovalVoter(address: string | null): void {
  modalsStore.update(s => ({ ...s, pendingRemovalVoter: address }));
}

export function setPendingRemovalProject(project: Project | null): void {
  modalsStore.update(s => ({ ...s, pendingRemovalProject: project }));
}

export function showError(message: string): void {
  modalsStore.update(s => ({ ...s, errorModalOpen: true, errorMessage: message }));
}

export function closeErrorModal(): void {
  modalsStore.update(s => ({ ...s, errorModalOpen: false, errorMessage: null }));
}
