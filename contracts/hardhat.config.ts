import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// WARNING: Never commit ANCHOR_WALLET_PRIVATE_KEY to version control.
// Set it in a local .env file (see README) and ensure .env is in .gitignore.
const config: HardhatUserConfig = {
  solidity: "0.8.26",
  networks: {
    fuji: {
      url: process.env.FUJI_RPC ?? "https://api.avax-test.network/ext/bc/C/rpc",
      accounts: process.env.ANCHOR_WALLET_PRIVATE_KEY
        ? [process.env.ANCHOR_WALLET_PRIVATE_KEY]
        : [],
    },
  },
};

export default config;
