import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const contractAddress = "0x5b0d8BC2533A64545d31B81ac10bDC734569880D";
  const contract = await ethers.getContractAt("ForumOracle", contractAddress);

  const owner = await contract.owner();
  const oracle = await contract.oracleAddress();

  console.log("Contract owner:", owner);
  console.log("Oracle address:", oracle);
  console.log("Backend wallet:", "0xf785b8f4dbe4A1F6DA30df47F84294580B0Bdfdc");
  console.log("Match:", oracle.toLowerCase() === "0xf785b8f4dbe4A1F6DA30df47F84294580B0Bdfdc".toLowerCase());
}

main().catch(console.error);
