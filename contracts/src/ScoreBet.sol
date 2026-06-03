// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./LuckyPool.sol";

/// @title ScoreBet — 正波膽 (correct score betting)
contract ScoreBet is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
    LuckyPool public pool;
    struct SBet { address user; uint256 matchId; bytes32 score; uint256 amount; uint256 odds; uint256 win; bool settled; bool won; }
    mapping(uint256 => SBet) public bets;
    uint256 public betCount;
    event SBetPlaced(uint256 id, address user, uint256 matchId, bytes32 score, uint256 amount);
    event SBetSettled(uint256 id, bool won);
    
    constructor() { _disableInitializers(); }
    function initialize(address _pool) public initializer {
        pool = LuckyPool(_pool);
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}
    
    function placeBet(uint256 _matchId, bytes32 _score, uint256 _amount) external whenNotPaused {
        require(_amount > 0 && pool.userBalance(msg.sender) >= _amount, "Invalid");
        betCount++;
        SBet storage b = bets[betCount];
        b.user = msg.sender; b.matchId = _matchId; b.score = _score; b.amount = _amount;
        b.odds = 500; b.win = _amount * b.odds / 100;
        emit SBetPlaced(betCount, msg.sender, _matchId, _score, _amount);
    }
    
    function settleBet(uint256 _betId, bytes32 _actualScore) external onlyOwner {
        SBet storage b = bets[_betId];
        require(!b.settled, "Already"); b.settled = true; b.won = (b.score == _actualScore);
        emit SBetSettled(_betId, b.won);
    }
}