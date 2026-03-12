import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const Escrow = await ethers.getContractFactory("ReflexArenaEscrow");
  const escrow = await Escrow.deploy(deployer.address);
  await escrow.waitForDeployment();

  console.log("ReflexArenaEscrow deployed to:", await escrow.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
