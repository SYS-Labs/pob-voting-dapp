import { formatContractAddress } from '~/utils';
import { NETWORKS } from '~/constants/networks';

interface ContractAddressProps {
  address: string;
  chainId: number;
  showShortOnMobile?: boolean;
}

const ContractAddress = ({ address, chainId, showShortOnMobile = true }: ContractAddressProps) => {
  const network = NETWORKS[chainId];
  const explorerUrl = network?.explorerUrl;
  const shortAddress = formatContractAddress(address);

  const content = showShortOnMobile ? (
    <>
      <span className="inline md:hidden">{shortAddress}</span>
      <span className="hidden md:inline">{address}</span>
    </>
  ) : (
    address
  );

  if (explorerUrl) {
    return (
      <a
        href={`${explorerUrl}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="pob-mono text-xs text-[var(--pob-primary)] transition-colors underline decoration-transparent hover:decoration-inherit"
      >
        {content}
      </a>
    );
  }

  return (
    <span className="pob-mono text-xs text-[var(--pob-primary)]">
      {content}
    </span>
  );
};

export default ContractAddress;
