/**
 * Error Handling Utilities
 *
 * Provides helpers to decode and display user-friendly error messages.
 */


// User-friendly error messages
export const ERROR_MESSAGES: Record<string, string> = {
  // JurySC_01 errors
  'NotActive': 'The iteration is not currently active.',
  'NotOwner': 'You do not have owner permissions for this action.',
  'AlreadyActivated': 'The iteration has already been activated.',
  'InsufficientQuorum': 'Not enough votes to meet quorum requirements.',
  'ProjectsLocked': 'Project registration is closed for this iteration.',
  'InvalidProject': 'This project is not registered or is invalid.',
  'ContractLocked': 'The contract is locked and cannot be modified.',
  'NotEnoughVoters': 'Not enough voters have participated yet.',
  'AlreadyVoted': 'You have already voted in this iteration.',
  'InvalidNFT': 'This NFT is not valid for the current iteration.',
  'ProjectCannotVote': 'Project addresses cannot vote.',
  'NotDevRelAccount': 'You are not authorized as a DevRel account.',
  'NotDaoHicVoter': 'You are not authorized as a DAO HIC voter.',
  'NoConsensus': 'No consensus has been reached among the voting entities.',
  'AlreadyClosed': 'This iteration has already been closed.',

  // PoB_01 errors
  'MintingIsClosed': 'The minting window for this iteration has closed.',
  'AlreadyClaimed': 'Rewards have already been claimed.',
  'InvalidAmount': 'Invalid ETH amount sent.',
  'OnlyCommunityCanClaim': 'Only community members can claim these rewards.',
  'VotingNotEnded': 'Voting period is still active.',
  'TransferFailed': 'ETH transfer failed.',
  'InvalidJurySC': 'Invalid JurySC contract address.',
  'NotAuthorized': 'You are not authorized for this action.',
  'NotNFTOwner': 'You do not own this NFT.',

  // OpenZeppelin errors
  'ReentrancyGuardReentrantCall': 'Reentrancy detected. Transaction rejected.',
  'OwnableUnauthorizedAccount': 'Unauthorized: only the owner can perform this action.',
  'OwnableInvalidOwner': 'Invalid owner address.',
  'ERC721NonexistentToken': 'This NFT does not exist.',
  'ERC721InvalidOwner': 'Invalid NFT owner address.',
  'ERC721InvalidSender': 'Invalid sender address.',
  'ERC721InvalidReceiver': 'Invalid receiver address.',
  'ERC721InsufficientApproval': 'Insufficient NFT approval.',
  'UUPSUnauthorizedCallContext': 'Unauthorized upgrade call context.',
  'InvalidInitialization': 'Invalid contract initialization.',
};

/**
 * Extract error name from contract revert
 */
export function parseContractError(error: any): string | null {
  const errorString = error?.message || error?.toString() || '';

  // Try to extract custom error name from various error formats
  const patterns = [
    /reverted with custom error '(\w+)'/,
    /Error: (\w+)\(/,
    /execution reverted: (\w+)/,
  ];

  for (const pattern of patterns) {
    const match = errorString.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Get user-friendly error message
 */
export function getErrorMessage(errorName: string | null): string {
  if (!errorName) {
    return 'Transaction failed. Please try again.';
  }

  return ERROR_MESSAGES[errorName] || `Contract error: ${errorName}`;
}


/**
 * Format contract error for display
 */
export function formatContractError(error: any): {
  title: string;
  message: string;
  technical?: string;
} {
  const errorName = parseContractError(error);
  const message = getErrorMessage(errorName);

  return {
    title: errorName || 'Transaction Failed',
    message,
    technical: error?.message || error?.toString(),
  };
}

export function isUserRejectedError(error: unknown): boolean {
  if (!error) return false;

  const err = error as {
    code?: string | number;
    message?: string;
    shortMessage?: string;
    reason?: string;
    error?: { code?: string | number; message?: string };
    info?: { error?: { code?: string | number; message?: string } };
    cause?: { message?: string; shortMessage?: string };
  };

  const code =
    err.code ??
    err.error?.code ??
    err.info?.error?.code;

  if (code === 4001 || code === '4001' || code === 'ACTION_REJECTED') {
    return true;
  }

  const message = [
    err.message,
    err.shortMessage,
    err.reason,
    err.error?.message,
    err.info?.error?.message,
    err.cause?.message,
    err.cause?.shortMessage,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('denied message signature') ||
    message.includes('rejected the request')
  );
}
