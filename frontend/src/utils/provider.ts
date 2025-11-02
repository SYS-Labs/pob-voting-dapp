import { BrowserProvider, Network } from 'ethers';

export function createProviderWithoutENS(ethereum: any, chainId: number): BrowserProvider {
  // Create a custom network without ENS - explicitly disable ENS by not providing plugins
  const network = Network.from({
    name: 'custom',
    chainId: chainId,
  });
  const provider = new BrowserProvider(ethereum, network);
  return provider;
}
