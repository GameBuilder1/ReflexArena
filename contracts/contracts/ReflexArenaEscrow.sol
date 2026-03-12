// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ReflexArenaEscrow
/// @notice Escrow contract for Reflex Arena match stakes
contract ReflexArenaEscrow is Ownable, ReentrancyGuard {
    /// @notice Balances held per user address
    mapping(address => uint256) public balances;

    /// @notice Tracks which matchIds have already been settled
    mapping(bytes32 => bool) public settled;

    event MatchSettled(
        bytes32 indexed matchId,
        address indexed winner,
        address indexed loser,
        uint256 stakeWei,
        uint256 payoutWei
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Deposit funds into escrow
    function deposit() external payable {
        require(msg.value > 0, "Must deposit > 0");
        balances[msg.sender] += msg.value;
    }

    /// @notice Withdraw funds from escrow
    /// @param amount Amount in wei to withdraw
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Must withdraw > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
    }

    /// @notice Settle a match and transfer stake from loser to winner
    /// @param matchId Unique match identifier
    /// @param winner Address of the winning player
    /// @param loser  Address of the losing player
    /// @param stakeWei Amount wagered by each player (winner receives this from loser)
    function settle(
        bytes32 matchId,
        address winner,
        address loser,
        uint256 stakeWei
    ) external onlyOwner {
        require(!settled[matchId], "Match already settled");
        require(winner != address(0) && loser != address(0), "Invalid addresses");
        require(winner != loser, "Winner and loser must differ");
        require(balances[loser] >= stakeWei, "Loser has insufficient balance");

        settled[matchId] = true;
        balances[loser] -= stakeWei;
        balances[winner] += stakeWei;

        emit MatchSettled(matchId, winner, loser, stakeWei, stakeWei);
    }
}
