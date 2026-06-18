// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VIPStaking — 5-level VIP system based on cumulative turnover
/// @notice VIP tiers determined by total turnover, with tiered rebates on anti-score, score, and AI bets
contract VIPStaking is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    struct VIPInfo {
        uint256 turnoverThreshold;  // Cumulative turnover required for this level (in USDT * 1e18)
        uint256 antiScoreRebate;    // Anti-score rebate in bps (e.g. 20 = 0.2%)
        uint256 scoreRebate;        // Score (正波膽) rebate in bps (e.g. 100 = 1%)
        uint256 aiRebate;           // AI investment rebate in bps (e.g. 10 = 0.1%)
    }

    struct UserInfo {
        uint256 cumulativeTurnover;  // Total betting turnover
        uint256 depositAmount;       // Agent deposit (returned on level-up)
        uint256 depositReturned;     // Whether deposit has been returned
        uint256 currentLevel;        // 0-5
        uint256 rewardsClaimed;      // Total rebates claimed
        uint256 since;               // First stake timestamp
    }

    mapping(address => UserInfo) public users;
    mapping(uint256 => VIPInfo) public vipTiers; // level 1-5

    uint256 public totalDeposits;
    
    event TurnoverUpdated(address indexed user, uint256 turnover, uint256 newLevel);
    event DepositMade(address indexed user, uint256 amount);
    event DepositReturned(address indexed user, uint256 amount);
    event VIPLevelUp(address indexed user, uint256 oldLevel, uint256 newLevel);
    event RebateClaimed(address indexed user, uint256 amount, uint256 category);

    constructor() { _disableInitializers(); }

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();

        // VIP 1: $20K turnover, 0.2% anti-score / 1% score / 0.1% AI rebate
        vipTiers[1] = VIPInfo(20_000 * 1e18, 20, 100, 10);
        // VIP 2: $100K, 0.4% / 2% / 0.2%
        vipTiers[2] = VIPInfo(100_000 * 1e18, 40, 200, 20);
        // VIP 3: $1M, 0.6% / 2.5% / 0.3%
        vipTiers[3] = VIPInfo(1_000_000 * 1e18, 60, 250, 30);
        // VIP 4: $10M, 0.7% / 3% / 0.4%
        vipTiers[4] = VIPInfo(10_000_000 * 1e18, 70, 300, 40);
        // VIP 5: $50M, 0.8% / 3.5% / 0.5%
        vipTiers[5] = VIPInfo(50_000_000 * 1e18, 80, 350, 50);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Record turnover for a user and update VIP level accordingly
    /// @param _user The user address
    /// @param _turnoverAmount Amount of turnover to record
    function recordTurnover(address _user, uint256 _turnoverAmount) external onlyOwner {
        require(_turnoverAmount > 0, "Zero turnover");
        UserInfo storage u = users[_user];
        uint256 oldLevel = u.currentLevel;
        
        u.cumulativeTurnover += _turnoverAmount;
        if (u.since == 0) {
            u.since = block.timestamp;
        }
        
        // Determine new VIP level based on cumulative turnover
        uint256 newLevel = 0;
        for (uint256 i = 5; i >= 1; i--) {
            if (u.cumulativeTurnover >= vipTiers[i].turnoverThreshold) {
                newLevel = i;
                break;
            }
        }
        
        u.currentLevel = newLevel;
        
        if (newLevel > oldLevel) {
            emit VIPLevelUp(_user, oldLevel, newLevel);
            // Return deposit on level-up if not already returned
            if (u.depositAmount > 0 && u.depositReturned < u.depositAmount) {
                u.depositReturned = u.depositAmount;
                emit DepositReturned(_user, u.depositAmount);
            }
        }
        
        emit TurnoverUpdated(_user, u.cumulativeTurnover, newLevel);
    }

    /// @notice Make agent deposit (stake for VIP level entry)
    /// @param _amount Deposit amount
    function deposit(uint256 _amount) external {
        require(_amount > 0, "Zero deposit");
        UserInfo storage u = users[msg.sender];
        u.depositAmount += _amount;
        totalDeposits += _amount;
        if (u.since == 0) {
            u.since = block.timestamp;
        }
        emit DepositMade(msg.sender, _amount);
    }

    /// @notice Withdraw deposit (only if VIP level achieved and deposit returned)
    function withdrawDeposit() external {
        UserInfo storage u = users[msg.sender];
        require(u.currentLevel > 0, "Not a VIP");
        require(u.depositReturned < u.depositAmount, "Already withdrawn");
        uint256 amount = u.depositAmount - u.depositReturned;
        u.depositReturned = u.depositAmount;
        totalDeposits -= amount;
        emit DepositReturned(msg.sender, amount);
    }

    /// @notice Claim accumulated rebates
    /// @param _category 0=antiScore, 1=score, 2=ai
    function claimRebate(uint256 _category) external {
        require(_category <= 2, "Invalid category");
        UserInfo storage u = users[msg.sender];
        require(u.currentLevel > 0, "Not a VIP");
        
        uint256 rebateRate;
        if (_category == 0) rebateRate = vipTiers[u.currentLevel].antiScoreRebate;
        else if (_category == 1) rebateRate = vipTiers[u.currentLevel].scoreRebate;
        else rebateRate = vipTiers[u.currentLevel].aiRebate;
        
        // Simplified: rewards = turnover * rebate / 10000
        uint256 reward = u.cumulativeTurnover * rebateRate / 10000;
        require(reward > u.rewardsClaimed, "No new rewards");
        
        uint256 claimable = reward - u.rewardsClaimed;
        u.rewardsClaimed = reward;
        
        emit RebateClaimed(msg.sender, claimable, _category);
    }

    /// @notice Get user VIP info
    function getUserInfo(address _user) external view returns (
        uint256 cumulativeTurnover,
        uint256 depositAmount,
        uint256 depositReturned,
        uint256 currentLevel,
        uint256 rewardsClaimed
    ) {
        UserInfo storage u = users[_user];
        return (u.cumulativeTurnover, u.depositAmount, u.depositReturned, u.currentLevel, u.rewardsClaimed);
    }

    /// @notice Get VIP tier rebate rates
    function getVIPTier(uint256 _level) external view returns (
        uint256 turnoverThreshold,
        uint256 antiScoreRebate,
        uint256 scoreRebate,
        uint256 aiRebate
    ) {
        require(_level >= 1 && _level <= 5, "Invalid level");
        VIPInfo storage v = vipTiers[_level];
        return (v.turnoverThreshold, v.antiScoreRebate, v.scoreRebate, v.aiRebate);
    }

    /// @notice Admin: update a VIP tier
    function setVIPTier(
        uint256 _level,
        uint256 _turnoverThreshold,
        uint256 _antiScoreRebate,
        uint256 _scoreRebate,
        uint256 _aiRebate
    ) external onlyOwner {
        require(_level >= 1 && _level <= 5, "Invalid level");
        vipTiers[_level] = VIPInfo(_turnoverThreshold, _antiScoreRebate, _scoreRebate, _aiRebate);
    }
}
