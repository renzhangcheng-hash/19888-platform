// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title LuckyPool — 資金池 (shared liquidity pool)
/// @notice Shared pool for anti-score betting, score betting, and AI vault.
///         Provides deposit/withdraw, overflow protection, circuit breaker,
///         daily drawdown tracking, and revenue recording.
contract LuckyPool is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable
{
    // ─── Reentrancy guard ───────────────────────────────────────
    uint256 private _status; // 0 = not entered, 1 = entered
    modifier nonReentrant() {
        require(_status == 0, "LuckyPool: reentrant call");
        _status = 1;
        _;
        _status = 0;
    }
    // ─── Constants ──────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10000; // basis points denominator

    // ─── ERC20 ──────────────────────────────────────────────────
    IERC20 public usdt;

    // ─── Pool accounting ────────────────────────────────────────
    uint256 public totalDeposits;
    uint256 public totalWithdrawals;
    uint256 public poolBalance; // tracked on-chain (mirrors USDT.balanceOf)

    // ─── Per-user balances ──────────────────────────────────────
    mapping(address => uint256) public userDeposits; // lifetime deposits
    mapping(address => uint256) public userBalance;  // current withdrawable

    // ─── Drawdown / risk controls ───────────────────────────────
    /// @notice Maximum daily loss in bps relative to poolBalance (300 = 3%).
    uint256 public dailyDrawdownLimitBps; // default 300 (3%)
    uint256 public dailyLoss;             // accumulated loss today
    uint256 public lastResetDay;          // timestamp of last daily reset

    /// @notice When true, all deposits AND bets are frozen.
    bool public circuitBreaker;

    // ─── Overflow protection ────────────────────────────────────
    /// @notice Safety threshold in bps — if total exposure exceeds this
    ///         fraction of poolBalance, the pool auto-pauses.
    ///         Default 8000 = 80% of pool exposed triggers pause.
    uint256 public overflowThresholdBps; // default 8000 (80%)

    /// @notice Total outstanding liability across all betting contracts.
    ///         Updated externally by AntiScoreBet / ScoreBet / AIVault.
    uint256 public totalExposure;

    // ─── Revenue tracking ───────────────────────────────────────
    /// @notice Revenue tracking: daily profit/loss for reporting.
    struct DailyRecord {
        uint256 date;       // unix day (midnight UTC)
        int256  profitLoss; // positive = profit, negative = loss
        uint256 poolSize;   // poolBalance at end of day
    }
    DailyRecord[] public dailyRecords;

    // Bookkeeping for current day
    int256  public currentDayPL;
    uint256 public currentDayDate;

    // ─── Authorization ──────────────────────────────────────────
    /// @notice Contracts authorized to call recordBet / recordPayout / updateExposure.
    mapping(address => bool) public authorizedContracts;

    // ─── Events ─────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event CircuitBreakerToggled(bool active);
    event DailyDrawdownHit(uint256 dailyLoss, uint256 poolBalance);
    event OverFlowProtectionTriggered(uint256 totalExposure, uint256 poolBalance);
    event DailySettled(uint256 date, int256 profitLoss, uint256 poolSize);
    event ExposureUpdated(uint256 totalExposure);
    event RevenueRecorded(uint256 amount);
    event ContractAuthorized(address indexed contractAddr, bool authorized);

    // ─── Constructor ────────────────────────────────────────────
    constructor() {
        _disableInitializers();
    }

    // ─── Initializer ────────────────────────────────────────────
    function initialize(address _usdt) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();

        usdt = IERC20(_usdt);

        dailyDrawdownLimitBps = 300;  // 3%
        overflowThresholdBps   = 8000; // 80%
        lastResetDay = block.timestamp;
        currentDayDate = _dayStart(block.timestamp);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── Modifiers ──────────────────────────────────────────────
    modifier onlyAuthorized() {
        require(
            msg.sender == owner() || authorizedContracts[msg.sender],
            "LuckyPool: not authorized"
        );
        _;
    }

    // ─── Authorization management ───────────────────────────────
    function setAuthorizedContract(address _contract, bool _authorized) external onlyOwner {
        authorizedContracts[_contract] = _authorized;
        emit ContractAuthorized(_contract, _authorized);
    }

    // ─── Deposit / Withdraw ─────────────────────────────────────
    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        require(!circuitBreaker, "LuckyPool: circuit breaker active");
        require(amount > 0, "LuckyPool: zero amount");

        require(usdt.transferFrom(msg.sender, address(this), amount), "LuckyPool: transfer failed");

        userDeposits[msg.sender] += amount;
        userBalance[msg.sender] += amount;
        totalDeposits += amount;
        poolBalance += amount;

        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "LuckyPool: zero amount");
        require(userBalance[msg.sender] >= amount, "LuckyPool: insufficient balance");

        userBalance[msg.sender] -= amount;
        totalWithdrawals += amount;
        poolBalance -= amount;

        require(usdt.transfer(msg.sender, amount), "LuckyPool: transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    // ─── Bet / Payout recording (called by authorized contracts) ─
    /// @notice Record a bet placed — deducts from user balance, updates exposure.
    function recordBet(address _user, uint256 _amount) external onlyAuthorized {
        require(userBalance[_user] >= _amount, "LuckyPool: insufficient user balance");
        userBalance[_user] -= _amount;
    }

    /// @notice Record a payout to a user — increases user balance, decreases pool.
    function recordPayout(address _user, uint256 _amount) external onlyAuthorized {
        userBalance[_user] += _amount;
        if (_amount > poolBalance) {
            poolBalance = 0;
        } else {
            poolBalance -= _amount;
        }
    }

    /// @notice Update total exposure (outstanding liability).
    function updateExposure(uint256 _totalExposure) external onlyAuthorized {
        totalExposure = _totalExposure;
        emit ExposureUpdated(_totalExposure);

        // Auto-pause if exposure exceeds overflow threshold
        _checkOverflow();
    }

    // ─── Revenue / Loss recording ───────────────────────────────
    /// @notice Record revenue (profit) flowing into the pool.
    function recordRevenue(uint256 _amount) external onlyAuthorized {
        poolBalance += _amount;
        currentDayPL += int256(_amount);
        emit RevenueRecorded(_amount);
    }

    /// @notice Record a loss flowing out of the pool.
    function recordLoss(uint256 _loss) external onlyAuthorized {
        _resetDailyIfNeeded();

        require(_loss <= poolBalance, "LuckyPool: loss exceeds pool");
        poolBalance -= _loss;
        dailyLoss += _loss;
        currentDayPL -= int256(_loss);

        // Check daily drawdown limit
        if (poolBalance > 0) {
            uint256 drawdownBps = dailyLoss * BPS_DENOMINATOR / poolBalance;
            if (drawdownBps >= dailyDrawdownLimitBps) {
                circuitBreaker = true;
                _pause();
                emit DailyDrawdownHit(dailyLoss, poolBalance);
                emit CircuitBreakerToggled(true);
            }
        }
    }

    // ─── Daily settlement ───────────────────────────────────────
    /// @notice Settle the current day's profit/loss. Callable by anyone after day rollover.
    function settleDaily() external {
        _resetDailyIfNeeded();
    }

    function getDailyRecordCount() external view returns (uint256) {
        return dailyRecords.length;
    }

    function getDailyRecord(uint256 _index) external view returns (uint256 date, int256 profitLoss, uint256 poolSize) {
        require(_index < dailyRecords.length, "LuckyPool: index out of bounds");
        DailyRecord memory r = dailyRecords[_index];
        return (r.date, r.profitLoss, r.poolSize);
    }

    // ─── Admin: set parameters ──────────────────────────────────
    function setDailyDrawdownLimit(uint256 _bps) external onlyOwner {
        require(_bps <= 1000, "LuckyPool: max 10%"); // 1000 bps = 10%
        dailyDrawdownLimitBps = _bps;
    }

    function setOverflowThreshold(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "LuckyPool: max 100%");
        overflowThresholdBps = _bps;
    }

    // ─── Circuit breaker ────────────────────────────────────────
    function toggleCircuitBreaker() external onlyOwner {
        circuitBreaker = !circuitBreaker;
        if (circuitBreaker) {
            _pause();
        } else {
            _unpause();
        }
        emit CircuitBreakerToggled(circuitBreaker);
    }

    /// @notice Emergency pause — stops all deposits, withdrawals, bets.
    function emergencyPause() external onlyOwner {
        _pause();
    }

    function emergencyUnpause() external onlyOwner {
        _unpause();
    }

    // ─── Pool health ────────────────────────────────────────────
    function getPoolHealth()
        external
        view
        returns (
            uint256 _poolBalance,
            uint256 _totalDeposits,
            uint256 _totalExposure,
            uint256 _dailyLoss,
            bool _circuitBreaker,
            bool _paused
        )
    {
        return (poolBalance, totalDeposits, totalExposure, dailyLoss, circuitBreaker, paused());
    }

    // ─── Internal helpers ────────────────────────────────────────
    function _checkOverflow() internal {
        if (poolBalance > 0 && totalExposure > 0) {
            uint256 exposureBps = totalExposure * BPS_DENOMINATOR / poolBalance;
            if (exposureBps >= overflowThresholdBps) {
                _pause();
                emit OverFlowProtectionTriggered(totalExposure, poolBalance);
            }
        }
    }

    function _resetDailyIfNeeded() internal {
        uint256 today = _dayStart(block.timestamp);
        if (today > currentDayDate) {
            // Archive previous day
            dailyRecords.push(DailyRecord({
                date: currentDayDate,
                profitLoss: currentDayPL,
                poolSize: poolBalance
            }));
            emit DailySettled(currentDayDate, currentDayPL, poolBalance);

            // Reset for new day
            currentDayDate = today;
            dailyLoss = 0;
            currentDayPL = 0;
            lastResetDay = block.timestamp;

            // Auto-reset circuit breaker on new day
            if (circuitBreaker) {
                circuitBreaker = false;
                if (paused()) {
                    _unpause();
                }
                emit CircuitBreakerToggled(false);
            }
        }
    }

    function _dayStart(uint256 _timestamp) internal pure returns (uint256) {
        return (_timestamp / 1 days) * 1 days;
    }
}
