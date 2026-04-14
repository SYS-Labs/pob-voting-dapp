#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { create } from 'ipfs-http-client';

interface BatchManifest {
  batchId: string;
  sourceChainId: number;
  sourceRpcUrl: string;
  sourceRegistryAddress: string;
  sourceDbPath: string | null;
  sourceDbPresent: boolean;
  exportTimestamp: string;
  exportToolVersion: string;
  artifactFiles: string[];
  contentHashes: Record<string, string>;
  counts: Record<string, number>;
  warnings: string[];
}

interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
}

interface ProofRecord {
  txHash: string;
}

interface MetadataRevision {
  txHash: string;
}

interface IterationMetadataEntry {
  history: MetadataRevision[];
}

interface ProjectMetadataEntry {
  history: MetadataRevision[];
}

interface AddedEntry {
  path: string;
  cid: string;
  size: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJSON(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(',')}}`;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function buildClient(apiUrl: string) {
  const parsed = new URL(apiUrl);
  return create({
    host: parsed.hostname,
    port: parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10),
    protocol: parsed.protocol.replace(':', '') as 'http' | 'https',
  });
}

async function main() {
  const batchDir = resolve(requiredEnv('MIGRATION_OUTPUT_DIR'));
  const ipfsApiUrl = process.env.IPFS_API_URL?.trim() || 'http://localhost:5001';

  const manifestPath = resolve(batchDir, 'manifest.json');
  const validationPath = resolve(batchDir, 'validation-report.json');
  const proofsPath = resolve(batchDir, 'proofs.json');
  const iterationMetadataPath = resolve(batchDir, 'iteration-metadata.json');
  const projectMetadataPath = resolve(batchDir, 'project-metadata.json');
  const removedProjectMetadataPath = resolve(batchDir, 'removed-project-metadata.json');

  for (const filePath of [manifestPath, validationPath, proofsPath, iterationMetadataPath, projectMetadataPath]) {
    if (!existsSync(filePath)) {
      throw new Error(`Required artifact file missing: ${filePath}`);
    }
  }

  const manifest = readJson<BatchManifest>(manifestPath);
  const validation = readJson<ValidationReport>(validationPath);
  if (!validation.ok) {
    throw new Error(`Batch ${manifest.batchId} is not validated; publish aborted`);
  }

  const proofs = readJson<ProofRecord[]>(proofsPath);
  const iterationMetadata = readJson<IterationMetadataEntry[]>(iterationMetadataPath);
  const projectMetadata = readJson<ProjectMetadataEntry[]>(projectMetadataPath);
  const removedProjectMetadata = existsSync(removedProjectMetadataPath)
    ? readJson<ProjectMetadataEntry[]>(removedProjectMetadataPath)
    : [];

  const client = buildClient(ipfsApiUrl);
  const addEntries: Array<{ path: string; content: Uint8Array }> = Array.from(new Set([
    'manifest.json',
    'validation-report.json',
    ...manifest.artifactFiles,
  ]))
    .sort()
    .map((relativePath) => ({
      path: relativePath,
      content: readFileSync(resolve(batchDir, relativePath)),
    }));

  const uploadedEntries: AddedEntry[] = [];
  for await (const entry of client.addAll(addEntries, {
    pin: true,
    cidVersion: 1,
    wrapWithDirectory: true,
  })) {
    uploadedEntries.push({
      path: entry.path,
      cid: entry.cid.toString(),
      size: Number(entry.size),
    });
  }

  const artifactRoot = uploadedEntries
    .slice()
    .reverse()
    .find((entry) => entry.path === '' || entry.path === '.')
    ?? uploadedEntries.at(-1);

  if (!artifactRoot) {
    throw new Error('Failed to determine artifact root CID');
  }

  const proofTxHashes = new Set<string>();
  for (const proof of proofs) {
    proofTxHashes.add(proof.txHash);
  }
  for (const entry of iterationMetadata) {
    for (const revision of entry.history) {
      proofTxHashes.add(revision.txHash);
    }
  }
  for (const entry of projectMetadata) {
    for (const revision of entry.history) {
      proofTxHashes.add(revision.txHash);
    }
  }
  for (const entry of removedProjectMetadata) {
    for (const revision of entry.history) {
      proofTxHashes.add(revision.txHash);
    }
  }

  const legacyTxHashes = Array.from(proofTxHashes).sort();
  const proofManifest = {
    version: 1,
    batchId: manifest.batchId,
    sourceChainId: manifest.sourceChainId,
    sourceRpcUrl: manifest.sourceRpcUrl,
    sourceRegistryAddress: manifest.sourceRegistryAddress,
    exportTimestamp: manifest.exportTimestamp,
    exportToolVersion: manifest.exportToolVersion,
    artifactRootCid: artifactRoot.cid,
    artifactRootPath: artifactRoot.path,
    artifactFiles: manifest.artifactFiles,
    contentHashes: manifest.contentHashes,
    counts: manifest.counts,
    validation: {
      ok: validation.ok,
      warnings: validation.warnings.length,
      errors: validation.errors.length,
    },
    lineageFiles: {
      manifest: 'manifest.json',
      validationReport: 'validation-report.json',
      proofs: 'proofs.json',
      iterationMetadata: 'iteration-metadata.json',
      projectMetadata: 'project-metadata.json',
      removedProjectMetadata: existsSync(removedProjectMetadataPath) ? 'removed-project-metadata.json' : null,
    },
    legacyTxHashes,
    legacyTxHashCounts: {
      unique: legacyTxHashes.length,
      proofs: proofs.length,
      iterationMetadataHistory: iterationMetadata.reduce((sum, entry) => sum + entry.history.length, 0),
      projectMetadataHistory: projectMetadata.reduce((sum, entry) => sum + entry.history.length, 0),
      removedProjectMetadataHistory: removedProjectMetadata.reduce((sum, entry) => sum + entry.history.length, 0),
    },
  };

  const proofResult = await client.add(canonicalJSON(proofManifest), {
    pin: true,
    cidVersion: 1,
    wrapWithDirectory: false,
  });

  const proofCid = proofResult.cid.toString();
  if (proofCid.length > 100) {
    throw new Error(`proofCid exceeds contract limit: ${proofCid}`);
  }

  console.log(JSON.stringify({
    batchId: manifest.batchId,
    batchDir,
    artifactRootCid: artifactRoot.cid,
    proofCid,
    ipfsApiUrl,
    uploadedFileCount: addEntries.length,
    legacyTxHashCount: legacyTxHashes.length,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
