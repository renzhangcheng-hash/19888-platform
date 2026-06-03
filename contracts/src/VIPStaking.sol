// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title VIPStaking — VIP tier staking system
contract VIPStaking is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    struct StakeInfo {
        uint256 amount;
        uint256 since;
        uint256 rewardsClaimed;
    }
    
    mapping(address => StakeInfo) public stakes;
    mapping(address => uint256) public vipLevels; // 1-5
    
    uint256 public totalStaked;
    uint256 public rewardRate;  // APR in bps
    uint256 public baseStakeForVIP1;
    uint256 public baseStakeForVIP2;
    uint256 public baseStakeForVIP3;
    uint256 public baseStakeForVIP4;
    uint256 public baseStakeForVIP5;
    
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event VIPLevelUp(address indexed user, uint256 newLevel);
    
    constructor() { _disableInitializers(); }
    function initialize() public initializer {
        __Ownable_init(msg.sender);
        rewardRate = 800; // 8% APR
        baseStakeForVIP1 = 100 * 1e18;  // 100 USDT
        baseStakeForVIP2 = 500 * 1e18;
        baseStakeForVIP3 = 1000 * 1e18;
        baseStakeForVIP4 = 5000 * 1e18;
        baseStakeForVIP5 = 10000 * 1e18;
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}
    
    function stake(uint256 _amount) external {
        require(_amount > 0, "Zero");
        stakes[msg.sender].amount += _amount;
        stakes[msg.sender].since = block.timestamp;
        totalStaked += _amount;
        _updateVIP(msg.sender);
        emit Staked(msg.sender, _amount);
    }
    
    function unstake(uint256 _amount) external {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= _amount, "Insufficient");
        s.amount -= _amount;
        totalStaked -= _amount;
        _updateVIP(msg.sender);
        emit Unstaked(msg.sender, _amount);
    }
    
    function _updateVIP(address _user) internal {
        uint256 staked = stakes[_user].amount;
        uint256 level;
        if (staked >= baseStakeForVIP5) level = 5;
        else if (staked >= baseStakeForVIP4) level = 4;
        else if (staked >= baseStakeForVIP3) level = 3;
        else if (staked >= baseStakeForVIP2) level = 2;
        else if (staked >= baseStakeForVIP1) level = 1;
        if (vipLevels[_user] != level) {
            vipLevels[_user] = level;
            if (level > 0) emit VIPLevelUp(_user, level);
        }
    }
    
    function getVIP(address _user) external view returns (uint256 staked, uint256 since, uint256 level) {
        return (stakes[_user].amount, stakes[_user].since, vipLevels[_user]);
    }
    
    function setVIPThresholds(uint256[5] calldata _thresholds) external onlyOwner {
        baseStakeForVIP1 = _thresholds[0];
        baseStakeForVIP2 = _thresholds[1];
        baseStakeForVIP3 = _thresholds[2];
        baseStakeForVIP4 = _thresholds[3];
        baseStakeForVIP5 = _thresholds[4];
    }
}
