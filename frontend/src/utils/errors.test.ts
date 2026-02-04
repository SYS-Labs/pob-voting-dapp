import { describe, it, expect } from 'vitest';
import {
  parseContractError,
  getErrorMessage,
  formatContractError,
  isUserRejectedError,
  ERROR_MESSAGES,
} from './errors';

describe('parseContractError', () => {
  it('extracts error from "reverted with custom error" format', () => {
    const error = { message: "reverted with custom error 'NotOwner'" };
    expect(parseContractError(error)).toBe('NotOwner');
  });

  it('extracts error from "Error:" format', () => {
    const error = { message: 'Error: AlreadyVoted(0x123)' };
    expect(parseContractError(error)).toBe('AlreadyVoted');
  });

  it('extracts error from "execution reverted" format', () => {
    const error = { message: 'execution reverted: InvalidProject' };
    expect(parseContractError(error)).toBe('InvalidProject');
  });

  it('returns null for unrecognized error format', () => {
    const error = { message: 'some random error' };
    expect(parseContractError(error)).toBeNull();
  });

  it('handles null/undefined error', () => {
    expect(parseContractError(null)).toBeNull();
    expect(parseContractError(undefined)).toBeNull();
  });
});

describe('getErrorMessage', () => {
  it('returns user-friendly message for known errors', () => {
    expect(getErrorMessage('NotOwner')).toBe('You do not have owner permissions for this action.');
    expect(getErrorMessage('AlreadyVoted')).toBe('You have already voted in this iteration.');
    expect(getErrorMessage('MintingIsClosed')).toBe('The minting window for this iteration has closed.');
  });

  it('returns default message for null', () => {
    expect(getErrorMessage(null)).toBe('Transaction failed. Please try again.');
  });

  it('returns generic message for unknown errors', () => {
    expect(getErrorMessage('UnknownError')).toBe('Contract error: UnknownError');
  });
});

describe('formatContractError', () => {
  it('formats error with title, message, and technical details', () => {
    const error = { message: "reverted with custom error 'NotOwner'" };
    const result = formatContractError(error);

    expect(result.title).toBe('NotOwner');
    expect(result.message).toBe('You do not have owner permissions for this action.');
    expect(result.technical).toBe("reverted with custom error 'NotOwner'");
  });

  it('handles unknown errors gracefully', () => {
    const error = { message: 'network timeout' };
    const result = formatContractError(error);

    expect(result.title).toBe('Transaction Failed');
    expect(result.message).toBe('Transaction failed. Please try again.');
  });
});

describe('isUserRejectedError', () => {
  it('detects rejection by code 4001', () => {
    expect(isUserRejectedError({ code: 4001 })).toBe(true);
    expect(isUserRejectedError({ code: '4001' })).toBe(true);
  });

  it('detects rejection by ACTION_REJECTED code', () => {
    expect(isUserRejectedError({ code: 'ACTION_REJECTED' })).toBe(true);
  });

  it('detects rejection by nested error code', () => {
    expect(isUserRejectedError({ error: { code: 4001 } })).toBe(true);
    expect(isUserRejectedError({ info: { error: { code: 4001 } } })).toBe(true);
  });

  it('detects rejection by message content', () => {
    expect(isUserRejectedError({ message: 'User rejected the request' })).toBe(true);
    expect(isUserRejectedError({ message: 'user denied transaction' })).toBe(true);
    expect(isUserRejectedError({ shortMessage: 'User rejected' })).toBe(true);
    expect(isUserRejectedError({ reason: 'User denied message signature' })).toBe(true);
  });

  it('detects rejection by cause message', () => {
    expect(isUserRejectedError({ cause: { message: 'user rejected' } })).toBe(true);
  });

  it('returns false for non-rejection errors', () => {
    expect(isUserRejectedError({ message: 'network error' })).toBe(false);
    expect(isUserRejectedError({ code: 4002 })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isUserRejectedError(null)).toBe(false);
    expect(isUserRejectedError(undefined)).toBe(false);
  });
});

describe('ERROR_MESSAGES', () => {
  it('contains JurySC errors', () => {
    expect(ERROR_MESSAGES.NotActive).toBeDefined();
    expect(ERROR_MESSAGES.AlreadyVoted).toBeDefined();
    expect(ERROR_MESSAGES.ProjectsLocked).toBeDefined();
  });

  it('contains PoB errors', () => {
    expect(ERROR_MESSAGES.MintingIsClosed).toBeDefined();
    expect(ERROR_MESSAGES.AlreadyClaimed).toBeDefined();
  });

  it('contains OpenZeppelin errors', () => {
    expect(ERROR_MESSAGES.ReentrancyGuardReentrantCall).toBeDefined();
    expect(ERROR_MESSAGES.OwnableUnauthorizedAccount).toBeDefined();
  });
});
