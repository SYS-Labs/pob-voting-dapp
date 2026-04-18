import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DisconnectModal from './DisconnectModal.svelte';

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onDisconnect: vi.fn(),
    onSwitchWallet: vi.fn(),
    onSwitchAccount: vi.fn(async () => undefined),
    canSwitchAccount: true,
    isSwitchingAccount: false,
    walletAddress: '0x1111111111111111111111111111111111111111',
    chainId: 57,
    networkLabel: 'Syscoin Mainnet',
    walletName: 'Rabby Wallet',
    walletIcon: null,
    ...overrides,
  };
}

describe('DisconnectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('disables account switching and shows guidance when unsupported', () => {
    render(DisconnectModal, {
      props: createProps({
        canSwitchAccount: false,
      }),
    });

    const switchAccountButton = screen.getByRole('button', { name: 'Switch Account' }) as HTMLButtonElement;
    expect(switchAccountButton.disabled).toBe(true);
    expect(screen.getByText('Account switching is not supported by this wallet. Switch accounts directly in the wallet extension.')).toBeTruthy();
  });

  it('keeps account switching available when supported', async () => {
    const onSwitchAccount = vi.fn(async () => undefined);

    render(DisconnectModal, {
      props: createProps({ onSwitchAccount }),
    });

    const switchAccountButton = screen.getByRole('button', { name: 'Switch Account' }) as HTMLButtonElement;
    expect(switchAccountButton.disabled).toBe(false);
    expect(screen.queryByText('Account switching is not supported by this wallet. Switch accounts directly in the wallet extension.')).toBeNull();

    await fireEvent.click(switchAccountButton);
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
  });
});
