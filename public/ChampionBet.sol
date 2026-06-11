// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./LuckyPool.sol";

/// @title ChampionBet — Champion & runner-up predictions
contract ChampionBet is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    LuckyPool public pool;
    struct CBet { address user; uint256 teamId; uint8 betType; uint256 amount; uint256 odds; uint256 win; bool settled; bool won; }
    mapping(uint256 => CBet) public bets;
    mapping(uint256 => uint256) public teamBets;
    uint256 public betCount; uint256 public championTeamId; uint256 public runnerUpTeamId; bool public resultSet;
    event CBetPlaced(uint256 id, address user, uint256 teamId, uint8 betType, uint256 amount);
    event CBetSettled(uint256 id, bool won);
    
    constructor() { _disableInitializers(); }
    function initialize(address _pool) public initializer {
        __Ownable_init(msg.sender);
        pool = LuckyPool(_pool);
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}
    
    function placeBet(uint256 _teamId, uint8 _betType, uint256 _amount) external {
        require((_betType == 1 || _betType == 2) && _amount > 0 && !resultSet && pool.userBalance(msg.sender) >= _amount, "Invalid");
        betCount++;
        CBet storage b = bets[betCount];
        b.user = msg.sender; b.teamId = _teamId; b.betType = _betType; b.amount = _amount;
        b.odds = _betType == 1 ? 600 : 450; b.win = _amount * b.odds / 100;
        teamBets[_teamId] += _amount;
        pool.recordBet(msg.sender, _amount);
        emit CBetPlaced(betCount, msg.sender, _teamId, _betType, _amount);
    }
    
    function setResult(uint256 _champion, uint256 _runnerUp) external onlyOwner {
        require(!resultSet, "Set"); championTeamId = _champion; runnerUpTeamId = _runnerUp; resultSet = true;
    }
    
    function settleBet(uint256 _betId) external onlyOwner {
        CBet storage b = bets[_betId];
        require(!b.settled && resultSet, "No"); b.settled = true;
        b.won = (b.betType == 1 && b.teamId == championTeamId) || (b.betType == 2 && b.teamId == runnerUpTeamId);
        if (b.won) pool.recordPayout(b.user, b.win);
        emit CBetSettled(_betId, b.won);
    }
}