// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LuckyPool is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
    IERC20 public usdt;
    uint256 public totalDeposits;
    uint256 public totalWithdrawals;
    uint256 public poolBalance;
    uint256 public dailyDrawdownLimit;
    uint256 public dailyLoss;
    uint256 public lastResetDay;
    bool public circuitBreaker;
    mapping(address => uint256) public userDeposits;
    mapping(address => uint256) public userBalance;
    
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event CircuitBreakerToggled(bool active);
    
    constructor() { _disableInitializers(); }
    
    function initialize(address _usdt) public initializer {
        __Ownable_init(msg.sender);
        usdt = IERC20(_usdt);
        dailyDrawdownLimit = 300;
        lastResetDay = block.timestamp;
    }
    
    function _authorizeUpgrade(address) internal override onlyOwner {}
    
    function deposit(uint256 amount) external whenNotPaused {
        require(!circuitBreaker, "CB active");
        require(amount > 0, "Zero");
        require(usdt.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        userDeposits[msg.sender] += amount;
        userBalance[msg.sender] += amount;
        totalDeposits += amount;
        poolBalance += amount;
        emit Deposited(msg.sender, amount);
    }
    
    function withdraw(uint256 amount) external whenNotPaused {
        require(amount > 0 && userBalance[msg.sender] >= amount, "Insufficient");
        require(usdt.transfer(msg.sender, amount), "Transfer failed");
        userBalance[msg.sender] -= amount;
        totalWithdrawals += amount;
        poolBalance -= amount;
        emit Withdrawn(msg.sender, amount);
    }
    
    function recordLoss(uint256 loss) external onlyOwner {
        _resetDailyIfNeeded();
        dailyLoss += loss;
        if (poolBalance > 0 && dailyLoss * 10000 / poolBalance > dailyDrawdownLimit) {
            circuitBreaker = true;
            emit CircuitBreakerToggled(true);
        }
    }
    
    function recordRevenue(uint256 revenue) external onlyOwner { poolBalance += revenue; }
    
    function toggleCircuitBreaker() external onlyOwner {
        circuitBreaker = !circuitBreaker;
        emit CircuitBreakerToggled(circuitBreaker);
    }
    
    function setDailyDrawdownLimit(uint256 _bps) external onlyOwner {
        require(_bps <= 1000, "Max 10%");
        dailyDrawdownLimit = _bps;
    }
    
    function _resetDailyIfNeeded() private {
        if (block.timestamp > lastResetDay + 1 days) {
            dailyLoss = 0;
            lastResetDay = block.timestamp;
            if (circuitBreaker) { circuitBreaker = false; emit CircuitBreakerToggled(false); }
        }
    }
    
    function getPoolHealth() external view returns (uint256, uint256, uint256, bool) {
        return (poolBalance, totalDeposits, dailyLoss, circuitBreaker);
    }
}