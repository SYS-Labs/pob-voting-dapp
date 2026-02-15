import { writable, derived } from 'svelte/store';
import { Contract, type Provider, type JsonRpcSigner } from 'ethers';
import type { UserProfile } from '~/interfaces';

// PoBRegistry ABI - only the profile functions we need
const PROFILE_ABI = [
  'function profilePictureCID(address) view returns (string)',
  'function profileBioCID(address) view returns (string)',
  'function setProfilePicture(string)',
  'function setProfileBio(string)',
];

// Per-chain PoBRegistry addresses (fill after deploy)
const REGISTRY_ADDRESSES: Record<number, string> = {
  // 57: '0x...', // Mainnet
  // 5700: '0x...', // Testnet
  // 31337: '0x...', // Hardhat
};

interface ProfileState {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProfileState = {
  profile: null,
  loading: false,
  error: null,
};

export const profileStateStore = writable<ProfileState>(initialState);

export const userProfile = derived(profileStateStore, ($s) => $s.profile);
export const profileLoading = derived(profileStateStore, ($s) => $s.loading);
export const profileError = derived(profileStateStore, ($s) => $s.error);

export async function loadProfile(
  chainId: number,
  address: string,
  provider: Provider
): Promise<void> {
  const registryAddr = REGISTRY_ADDRESSES[chainId];
  if (!registryAddr) return;

  profileStateStore.update((s) => ({ ...s, loading: true, error: null }));

  try {
    const registry = new Contract(registryAddr, PROFILE_ABI, provider);
    const [pictureCID, bioCID] = await Promise.all([
      registry.profilePictureCID(address),
      registry.profileBioCID(address),
    ]);

    profileStateStore.set({
      profile: { address, pictureCID, bioCID },
      loading: false,
      error: null,
    });
  } catch (err) {
    profileStateStore.update((s) => ({
      ...s,
      loading: false,
      error: err instanceof Error ? err.message : 'Failed to load profile',
    }));
  }
}

export async function setProfilePicture(
  chainId: number,
  cid: string,
  signer: JsonRpcSigner
): Promise<void> {
  const registryAddr = REGISTRY_ADDRESSES[chainId];
  if (!registryAddr) throw new Error('Registry not configured for this network');

  const registry = new Contract(registryAddr, PROFILE_ABI, signer);
  const tx = await registry.setProfilePicture(cid);
  await tx.wait();
}

export async function setProfileBio(
  chainId: number,
  cid: string,
  signer: JsonRpcSigner
): Promise<void> {
  const registryAddr = REGISTRY_ADDRESSES[chainId];
  if (!registryAddr) throw new Error('Registry not configured for this network');

  const registry = new Contract(registryAddr, PROFILE_ABI, signer);
  const tx = await registry.setProfileBio(cid);
  await tx.wait();
}

export function resetProfileState(): void {
  profileStateStore.set(initialState);
}
