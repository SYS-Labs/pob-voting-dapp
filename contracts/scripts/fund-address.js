import pkg from "hardhat";
const { ethers } = pkg;

/**
 * Quick script to fund a specific address
 * Usage: node scripts/fund-address.js <address> [amount_in_eth]
 */

async function main() {
  const [deployer] = await ethers.getSigners();

  const targetAddress = process.argv[2];
  const amountEth = process.argv[3] || "50";

  if (!targetAddress) {
    console.error("❌ Usage: node scripts/fund-address.js <address> [amount_in_eth]");
    console.error("Example: node scripts/fund-address.js 0x1234... 50");
    process.exit(1);
  }

  let checksumAddress;
  try {
    checksumAddress = ethers.getAddress(targetAddress);
  } catch (error) {
    console.error(`❌ Invalid address: ${targetAddress}`);
    process.exit(1);
  }

  const amount = ethers.parseEther(amountEth);
  const currentBalance = await ethers.provider.getBalance(checksumAddress);

  console.log(`\n📊 Current balance: ${ethers.formatEther(currentBalance)} ETH`);
  console.log(`💰 Funding ${checksumAddress} with ${amountEth} ETH...`);

  const tx = await deployer.sendTransaction({
    to: checksumAddress,
    value: amount
  });

  await tx.wait();

  const newBalance = await ethers.provider.getBalance(checksumAddress);
  console.log(`✅ New balance: ${ethers.formatEther(newBalance)} ETH`);
  console.log(`\n💡 Account now has enough to mint community badge (30 ETH deposit + gas)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
