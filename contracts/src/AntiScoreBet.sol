// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./LuckyPool.sol";

contract AntiScoreBet is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
    LuckyPool public pool;
    
    struct Match { uint256 id; string home; string away; uint256 startTime; bytes32 finalScore; bool settled; uint256 totalBets; }
    struct Bet { address user; uint256 matchId; uint8 cellIndex; uint256 amount; uint256 odds; uint256 potentialWin; bool settled; bool won; uint256 payout; }
    
    mapping(uint256 => Match) public matches;
    mapping(uint256 => Bet) public bets;
    mapping(uint256 => mapping(uint8 => uint256)) public cellBets;
    uint256 public matchCount;
    uint256 public betCount;
    uint256 public maxCellExposure;
    
    event BetPlaced(uint256 indexed betId, address indexed user, uint256 matchId, uint8 cell, uint256 amount);
    event MatchSettled(uint256 indexed matchId, bytes32 finalScore);
    event BetSettled(uint256 indexed betId, bool won, uint256 payout);
    
    constructor() { _disableInitializers(); }
    
    function initialize(address _pool) public initializer {
        __Ownable_init(msg.sender);
        pool = LuckyPool(_pool);
        maxCellExposure = 1000;
    }
    
    function _authorizeUpgrade(address) internal override onlyOwner {}
    
    function createMatch(uint256 _id, string calldata _home, string calldata _away, uint256 _startTime) external onlyOwner {
        Match storage m = matches[_id];
        m.id = _id; m.home = _home; m.away = _away; m.startTime = _startTime;
        matchCount++;
    }
    
    function placeBet(uint256 _matchId, uint8 _cellIndex, uint256 _amount) external whenNotPaused {
        require(_cellIndex < 18 && _amount > 0, "Invalid");
        Match storage m = matches[_matchId];
        require(m.id == _matchId && block.timestamp < m.startTime && !m.settled, "Not allowed");
        require(pool.userBalance(msg.sender) >= _amount, "Insufficient");
        betCount++;
        Bet storage b = bets[betCount];
        b.user = msg.sender; b.matchId = _matchId; b.cellIndex = _cellIndex; b.amount = _amount;
        b.odds = 200; b.potentialWin = _amount * b.odds / 10000;
        cellBets[_matchId][_cellIndex] += _amount;
        m.totalBets += _amount;
        emit BetPlaced(betCount, msg.sender, _matchId, _cellIndex, _amount);
    }
    
    function settleMatch(uint256 _matchId, bytes32 _finalScore) external onlyOwner {
        Match storage m = matches[_matchId];
        require(m.id == _matchId && !m.settled, "No");
        m.finalScore = _finalScore; m.settled = true;
        emit MatchSettled(_matchId, _finalScore);
    }
    
    function settleBet(uint256 _betId) external onlyOwner {
        Bet storage b = bets[_betId];
        require(!b.settled && matches[b.matchId].settled, "Not ready");
        b.settled = true;
        b.won = true; // Simplified: all anti-bets win in demo
        b.payout = b.potentialWin;
        emit BetSettled(_betId, b.won, b.payout);
    }
}