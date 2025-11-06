/**
 * Wait for a transaction to be mined using manual polling.
 * Works around slow confirmation times on Syscoin NEVM.
 *
 * @param {ethers.TransactionResponse} tx - Transaction response
 * @param {number} confirmations - Number of confirmations to wait for
 * @param {number} pollInterval - Polling interval in milliseconds
 * @param {ethers.Provider} provider - Ethers provider (optional, uses tx.provider if available)
 */
export async function waitForTxWithPolling(tx, confirmations = 1, pollInterval = 20_000, provider = null) {
  console.log(`  Transaction hash: ${tx.hash}`);
  console.log(`  Waiting for ${confirmations} confirmation(s)...`);

  // Use provided provider or fall back to tx.provider
  const txProvider = provider || tx.provider;
  if (!txProvider) {
    throw new Error('No provider available for transaction polling');
  }

  let receipt = null;
  let attempts = 0;
  const maxAttempts = 60; // 20 minutes

  while (!receipt && attempts < maxAttempts) {
    attempts += 1;

    try {
      receipt = await txProvider.getTransactionReceipt(tx.hash);
      if (receipt) {
        console.log(`  ✓ Transaction mined in block ${receipt.blockNumber}`);

        if (confirmations > 1) {
          const currentBlock = await txProvider.getBlockNumber();
          const confirmationsReceived = currentBlock - receipt.blockNumber + 1;

          if (confirmationsReceived < confirmations) {
            console.log(`  Waiting for ${confirmations - confirmationsReceived} more confirmation(s)...`);
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            receipt = null;
            continue;
          }
        }

        return receipt;
      }
    } catch (error) {
      if (error.code !== "NETWORK_ERROR") {
        console.log(`  Polling attempt ${attempts}/${maxAttempts}...`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Transaction ${tx.hash} not mined after ${maxAttempts} attempts`);
}
