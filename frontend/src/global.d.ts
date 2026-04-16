declare global {
  interface EthereumProvider {
    request<T = unknown>(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<T>;
    on?(event: string, listener: (...args: unknown[]) => void): void;
    removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  }

  interface EIP6963ProviderInfo {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  }

  interface EIP6963ProviderDetail {
    info: EIP6963ProviderInfo;
    provider: EthereumProvider;
  }

  interface EIP6963AnnounceProviderEvent extends CustomEvent<EIP6963ProviderDetail> {
    type: 'eip6963:announceProvider';
  }

  interface Window {
    ethereum?: EthereumProvider;
  }
}

export {};
