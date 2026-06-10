import { writable, derived } from 'svelte/store';
import type { Project } from '~/interfaces';

// ============================================================================
// Types
// ============================================================================

/** Entity-0 voter (SMT) vs entity-1 voter (DAO HIC) — selects the on-chain remove method. */
export type VoterEntity = 'smt' | 'daohic';

export interface PendingVoterRemoval {
  address: string;
  entity: VoterEntity;
}

interface ModalsState {
  switchNetworkModalOpen: boolean;
  disconnectModalOpen: boolean;
  pendingRemovalVoter: PendingVoterRemoval | null;
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

export function setPendingRemovalVoter(voter: PendingVoterRemoval | null): void {
  modalsStore.update(s => ({ ...s, pendingRemovalVoter: voter }));
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
