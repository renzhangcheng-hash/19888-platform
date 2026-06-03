// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./LuckyPool.sol";

/// @title AIVault — AI strategy revenue vault
contract AIVault is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    LuckyPool public pool;
    uint256 public totalRevenue;     // Accumulated AI revenue
    uint256 public lastUpdate;       // Last revenue update
    mapping(address => uint256) public userShares;
    
    event RevenueAdded(uint256 amount);
    
    constructor() { _disableInitializers(); }
    function initialize(address _pool) public initializer {
        __Ownable_init(msg.sender);
        pool = LuckyPool(_pool);
        lastUpdate = block.timestamp;
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}
    
    function addRevenue(uint256 _amount) external onlyOwner {
        totalRevenue += _amount;
        lastUpdate = block.timestamp;
        pool.recordRevenue(_amount);
        emit RevenueAdded(_amount);
    }
    
    function getAPR() external view returns (uint256 apr) {
        if (totalRevenue == 0 || lastUpdate == initTime()) return 0;
        uint256 elapsed = block.timestamp - initTime();
        return elapsed > 0 ? totalRevenue * 365 days * 10000 / elapsed / totalRevenue : 0;
    }
    
    function initTime() private view returns (uint256) {
        return lastUpdate > 0 ? lastUpdate - (totalRevenue > 0 ? 0 : 0) : block.timestamp;
    }
}
