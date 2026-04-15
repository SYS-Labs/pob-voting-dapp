import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getIterationMetadataCID: vi.fn(),
  batchGetByCIDs: vi.fn(),
  getIterationMetadata: vi.fn(),
}));

vi.mock('./registry', () => ({
  getIterationMetadataCID: mocks.getIterationMetadataCID,
}));

vi.mock('./metadata-api', () => ({
  metadataAPI: {
    batchGetByCIDs: mocks.batchGetByCIDs,
    getIterationMetadata: mocks.getIterationMetadata,
  },
}));

import { getIterationMetadataByCID, getResolvedIterationMetadata } from './iterationMetadata';

describe('iterationMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads iteration metadata by CID through the metadata batch endpoint', async () => {
    mocks.batchGetByCIDs.mockResolvedValue({
      'bafkrei-round': { name: 'Round Name', description: 'Round description' },
    });

    await expect(getIterationMetadataByCID('bafkrei-round')).resolves.toEqual({
      name: 'Round Name',
      description: 'Round description',
    });
    expect(mocks.batchGetByCIDs).toHaveBeenCalledWith(['bafkrei-round']);
  });

  it('uses the registry CID before the by-address API endpoint', async () => {
    const provider = {} as never;
    mocks.getIterationMetadataCID.mockResolvedValue('bafkrei-round');
    mocks.batchGetByCIDs.mockResolvedValue({
      'bafkrei-round': { name: 'Registry Round', description: 'Registry description' },
    });
    mocks.getIterationMetadata.mockResolvedValue({ name: 'API Round' });

    await expect(getResolvedIterationMetadata(57, '0x0000000000000000000000000000000000000001', provider)).resolves.toEqual({
      name: 'Registry Round',
      description: 'Registry description',
    });
    expect(mocks.getIterationMetadata).not.toHaveBeenCalled();
  });

  it('falls back to the by-address API endpoint when no registry CID is available', async () => {
    const provider = {} as never;
    mocks.getIterationMetadataCID.mockResolvedValue(null);
    mocks.getIterationMetadata.mockResolvedValue({ name: 'API Round' });

    await expect(getResolvedIterationMetadata(57, '0x0000000000000000000000000000000000000001', provider)).resolves.toEqual({
      name: 'API Round',
    });
    expect(mocks.getIterationMetadata).toHaveBeenCalledWith(57, '0x0000000000000000000000000000000000000001');
  });
});
