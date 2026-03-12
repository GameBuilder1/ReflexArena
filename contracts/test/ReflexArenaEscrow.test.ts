import { expect } from "chai";
import { ethers } from "hardhat";
import { ReflexArenaEscrow } from "../typechain-types";

describe("ReflexArenaEscrow", () => {
  let escrow: ReflexArenaEscrow;
  let owner: Awaited<ReturnType<typeof ethers.getSigner>>;
  let playerA: Awaited<ReturnType<typeof ethers.getSigner>>;
  let playerB: Awaited<ReturnType<typeof ethers.getSigner>>;

  beforeEach(async () => {
    [owner, playerA, playerB] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("ReflexArenaEscrow");
    escrow = (await Escrow.deploy(owner.address)) as unknown as ReflexArenaEscrow;
    await escrow.waitForDeployment();
  });

  describe("deposit", () => {
    it("should credit balance on deposit", async () => {
      const amount = ethers.parseEther("1.0");
      await escrow.connect(playerA).deposit({ value: amount });
      expect(await escrow.balances(playerA.address)).to.equal(amount);
    });

    it("should revert when depositing 0", async () => {
      await expect(
        escrow.connect(playerA).deposit({ value: 0 })
      ).to.be.revertedWith("Must deposit > 0");
    });
  });

  describe("withdraw", () => {
    it("should allow withdrawal of deposited funds", async () => {
      const amount = ethers.parseEther("1.0");
      await escrow.connect(playerA).deposit({ value: amount });

      const balanceBefore = await ethers.provider.getBalance(playerA.address);
      const tx = await escrow.connect(playerA).withdraw(amount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * (receipt!.gasPrice ?? 0n);
      const balanceAfter = await ethers.provider.getBalance(playerA.address);

      expect(balanceAfter).to.equal(balanceBefore + amount - gasUsed);
      expect(await escrow.balances(playerA.address)).to.equal(0);
    });

    it("should revert when withdrawing more than balance", async () => {
      await expect(
        escrow.connect(playerA).withdraw(ethers.parseEther("1.0"))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("should revert when withdrawing 0", async () => {
      await expect(
        escrow.connect(playerA).withdraw(0)
      ).to.be.revertedWith("Must withdraw > 0");
    });
  });

  describe("settle", () => {
    const matchId = ethers.keccak256(ethers.toUtf8Bytes("match-1"));
    const stake = ethers.parseEther("0.5");

    beforeEach(async () => {
      await escrow.connect(playerA).deposit({ value: stake });
      await escrow.connect(playerB).deposit({ value: stake });
    });

    it("should transfer stake from loser to winner", async () => {
      await escrow.connect(owner).settle(matchId, playerA.address, playerB.address, stake);

      expect(await escrow.balances(playerA.address)).to.equal(stake * 2n);
      expect(await escrow.balances(playerB.address)).to.equal(0);
    });

    it("should emit MatchSettled event", async () => {
      await expect(
        escrow.connect(owner).settle(matchId, playerA.address, playerB.address, stake)
      )
        .to.emit(escrow, "MatchSettled")
        .withArgs(matchId, playerA.address, playerB.address, stake, stake);
    });

    it("should mark match as settled", async () => {
      await escrow.connect(owner).settle(matchId, playerA.address, playerB.address, stake);
      expect(await escrow.settled(matchId)).to.be.true;
    });

    it("should revert on duplicate settlement", async () => {
      await escrow.connect(owner).settle(matchId, playerA.address, playerB.address, stake);
      await expect(
        escrow.connect(owner).settle(matchId, playerA.address, playerB.address, stake)
      ).to.be.revertedWith("Match already settled");
    });

    it("should revert if non-owner calls settle", async () => {
      await expect(
        escrow.connect(playerA).settle(matchId, playerA.address, playerB.address, stake)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("should revert when loser has insufficient balance", async () => {
      const bigStake = ethers.parseEther("10.0");
      await expect(
        escrow.connect(owner).settle(matchId, playerA.address, playerB.address, bigStake)
      ).to.be.revertedWith("Loser has insufficient balance");
    });
  });
});
