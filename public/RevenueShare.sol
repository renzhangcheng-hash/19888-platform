// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./LuckyPool.sol";

/// @title RevenueShare — Revenue distribution
contract RevenueShare is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    LuckyPool public pool;
    uint256 public totalFeesCollected;
    uint256 public agentShare;     // 30% = 3000
    uint256 public treasuryShare;  // 30% = 3000
    uint256 public stakerShare;    // 30% = 3000
    uint256 public teamShare;      // 10% = 1000
    
    constructor() { _disableInitializers(); }
    function initialize(address _pool) public initializer {
        __Ownable_init(msg.sender);
        pool = LuckyPool(_pool);
        agentShare = 3000; treasuryShare = 3000; stakerShare = 3000; teamShare = 1000;
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}
    
    function collectFee(uint256 _amount) external onlyOwner {
        totalFeesCollected += _amount;
    }
    
    function setShares(uint256 _agent, uint256 _treasury, uint256 _staker, uint256 _team) external onlyOwner {
        require(_agent + _treasury + _staker + _team == 10000, "Must sum to 100%");
        agentShare = _agent; treasuryShare = _treasury; stakerShare = _staker; teamShare = _team;
    }
}
