#!/usr/bin/env tsx
/**
 * IPFS Connection Test Script
 *
 * Tests IPFS connectivity using the existing IPFSService
 * Run with: tsx --env-file=.env scripts/test-ipfs-connection.ts
 */

import { IPFSService } from '../src/services/ipfs.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

async function testIPFSConnection() {
  console.log(`${BLUE}==================================${RESET}`);
  console.log(`${BLUE}   IPFS Connection Test${RESET}`);
  console.log(`${BLUE}==================================${RESET}\n`);

  const ipfs = new IPFSService();
  let uploadedCID: string | null = null;

  try {
    // Test 1: Get node info
    console.log(`${YELLOW}[1/5]${RESET} Testing node connectivity...`);
    const nodeInfo = await ipfs.getNodeInfo();
    console.log(`${GREEN}✓${RESET} Connected to IPFS node`);
    console.log(`  ID: ${nodeInfo.id}`);
    console.log(`  Version: ${nodeInfo.agentVersion}`);
    console.log(`  Protocol: ${nodeInfo.protocolVersion}`);
    console.log(`  Addresses: ${nodeInfo.addresses.length} address(es)\n`);

    // Test 2: Upload test data
    console.log(`${YELLOW}[2/5]${RESET} Uploading test JSON object...`);
    const testData = {
      message: 'IPFS connection test',
      timestamp: new Date().toISOString(),
      test: true,
      metadata: {
        project: 'Proof-of-Builders',
        purpose: 'Connection test'
      }
    };

    uploadedCID = await ipfs.uploadJSON(testData, 'connection-test');
    console.log(`${GREEN}✓${RESET} Successfully uploaded to IPFS`);
    console.log(`  CID: ${uploadedCID}\n`);

    // Test 3: Fetch data back
    console.log(`${YELLOW}[3/5]${RESET} Fetching data from IPFS...`);
    const fetchedData = await ipfs.fetchJSON(uploadedCID);
    console.log(`${GREEN}✓${RESET} Successfully fetched data from IPFS`);

    // Verify data integrity
    // Note: Properties may be in different order due to canonical JSON sorting
    const uploadedStr = JSON.stringify(testData, Object.keys(testData).sort());
    const fetchedStr = JSON.stringify(fetchedData, Object.keys(fetchedData).sort());

    if (uploadedStr === fetchedStr) {
      console.log(`${GREEN}✓${RESET} Data integrity verified (content matches)\n`);
    } else {
      console.log(`${RED}✗${RESET} Data mismatch!\n`);
      console.log('  Uploaded:', testData);
      console.log('  Fetched:', fetchedData);
      throw new Error('Data integrity check failed');
    }

    // Test canonical JSON determinism
    console.log(`${YELLOW}[3.5/5]${RESET} Testing canonical JSON determinism...`);
    const reorderedData = {
      metadata: testData.metadata,
      message: testData.message,
      timestamp: testData.timestamp,
      test: testData.test
    };
    const cid2 = await ipfs.uploadJSON(reorderedData, 'determinism-test');

    if (cid2 === uploadedCID) {
      console.log(`${GREEN}✓${RESET} Canonical JSON working! Same content = same CID`);
      console.log(`  Both CIDs: ${uploadedCID}\n`);
    } else {
      console.log(`${RED}✗${RESET} Canonical JSON failed!`);
      console.log(`  Original CID: ${uploadedCID}`);
      console.log(`  Reordered CID: ${cid2}\n`);
      throw new Error('Canonical JSON determinism failed');
    }

    // Clean up second CID (same as first, but just in case)
    if (cid2 !== uploadedCID) {
      await ipfs.unpin(cid2);
    }

    // Test 4: Check pin status
    console.log(`${YELLOW}[4/5]${RESET} Checking pin status...`);
    const isPinned = await ipfs.isPinned(uploadedCID);
    if (isPinned) {
      console.log(`${GREEN}✓${RESET} CID is pinned on the node\n`);
    } else {
      console.log(`${YELLOW}⚠${RESET} CID is not pinned (unexpected)\n`);
    }

    // Test 5: Clean up (unpin)
    console.log(`${YELLOW}[5/5]${RESET} Cleaning up (unpinning test data)...`);
    await ipfs.unpin(uploadedCID);
    console.log(`${GREEN}✓${RESET} Successfully unpinned test data\n`);

    // Verify unpinned
    const stillPinned = await ipfs.isPinned(uploadedCID);
    if (!stillPinned) {
      console.log(`${GREEN}✓${RESET} Confirmed: CID is no longer pinned\n`);
    } else {
      console.log(`${YELLOW}⚠${RESET} CID still appears pinned (may take time to update)\n`);
    }

    // Summary
    console.log(`${BLUE}==================================${RESET}`);
    console.log(`${GREEN}✓ All tests passed!${RESET}`);
    console.log(`${BLUE}==================================${RESET}\n`);

    console.log('Configuration used:');
    console.log(`  IPFS_API_URL: ${process.env.IPFS_API_URL || 'http://localhost:5001'}`);
    console.log(`  IPFS_USE_DAG: ${process.env.IPFS_USE_DAG !== 'false' ? 'true' : 'false'}`);
    if (process.env.IPFS_FALLBACK_API_URL) {
      console.log(`  IPFS_FALLBACK_API_URL: ${process.env.IPFS_FALLBACK_API_URL}`);
    }

    process.exit(0);
  } catch (error: any) {
    console.log(`\n${RED}✗ Test failed!${RESET}\n`);
    console.error('Error:', error.message);
    console.error('Error code:', error.code);
    console.error('Error cause:', error.cause);

    console.log(`\n${YELLOW}Troubleshooting:${RESET}`);
    console.log('  • Check IPFS_API_URL in .env file');
    console.log('  • Current setting: ' + (process.env.IPFS_API_URL || 'http://localhost:5001'));

    if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
      console.log('  • Connection refused - Is the IPFS daemon running on the remote server?');
      console.log('  • Is the remote IPFS API accessible from this machine?');
      console.log('  • Check firewall rules and network connectivity');
    } else if (error.code === 'ENOTFOUND' || error.cause?.code === 'ENOTFOUND') {
      console.log('  • Hostname not found - Check the hostname in IPFS_API_URL');
    } else if (error.code === 'ETIMEDOUT' || error.cause?.code === 'ETIMEDOUT') {
      console.log('  • Connection timeout - Check network connectivity to remote IPFS server');
    }

    // Clean up on error if CID was created
    if (uploadedCID) {
      try {
        console.log(`\n${YELLOW}Attempting cleanup...${RESET}`);
        await ipfs.unpin(uploadedCID);
        console.log(`${GREEN}✓${RESET} Cleaned up test data`);
      } catch (cleanupError) {
        console.log(`${RED}✗${RESET} Failed to cleanup test data`);
      }
    }

    process.exit(1);
  }
}

testIPFSConnection();
