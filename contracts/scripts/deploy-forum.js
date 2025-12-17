import pkg from "hardhat";
const { ethers, network } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  // Oracle address: use env var if provided, otherwise use deployer
  const oracleAddress = process.env.ORACLE_ADDRESS ?? deployer.address;

  console.log("===========================================");
  console.log("Deploying ForumOracle contract");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log(
    "Deployer balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "SYS"
  );
  console.log("Oracle address:", oracleAddress);
  console.log("===========================================");

  const ForumOracle = await ethers.getContractFactory("ForumOracle");
  const forumOracle = await ForumOracle.deploy(oracleAddress);
  await forumOracle.waitForDeployment();

  const address = await forumOracle.getAddress();
  console.log(`✓ ForumOracle deployed to: ${address}`);
  console.log(`  Owner: ${deployer.address}`);
  console.log(`  Oracle: ${oracleAddress}`);

  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\nVerify on the block explorer once the transaction is indexed:");
    console.log(
      `npx hardhat verify --network ${network.name} ${address} ${oracleAddress}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
