// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./LuckyPool.sol";

/// @title AIVault — AI 智投 (AI-managed investment vault)
/// @notice Users deposit USDT into the vault; AI strategies manage the funds.
///
///         Features:
///         - Per-user managed amount: 100–10,000 USDT
///         - Daily settlement at 00:00 UTC
///         - Daily return rate: 0.3%–1.2% (configurable)
///         - Stop-loss: auto-pause after 3 consecutive loss days
///         - Kelly formula position sizing (configurable fraction)
///         - Lock period: funds locked during active management
///         - Emergency withdrawal with penalty
contract AIVault is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable
{
    // ─── Reentrancy guard ───────────────────────────────────────
    uint256 private _status;
    modifier nonReentrant() {
        require(_status == 0, "AIVault: reentrant call");
        _status = 1;
        _;
        _status = 0;
    }
    LuckyPool public pool;

    // ─── Constants ──────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MIN_MANAGED     = 100 ether;    // 100 USDT
    uint256 public constant MAX_MANAGED     = 10000 ether;  // 10,000 USDT
    uint256 public constant MAX_CONSECUTIVE_LOSSES = 3;

    // ─── User position ──────────────────────────────────────────
    struct Position {
        uint256 deposited;       // total deposited by user
        uint256 managedAmount;   // actively managed amount
        uint256 pendingWithdraw; // amount requested for withdrawal (locked period)
        uint256 lockUntil;       // timestamp when position unlocks
        uint256 lastSettleDay;   // last day the user was settled
        uint256 cumulativeReturn; // total return accrued (in USDT)
        bool    active;
    }

    mapping(address => Position) public positions;

    // ─── Configurable parameters ────────────────────────────────
    /// @notice Daily return rate in bps. Default 60 = 0.6%.
    uint256 public dailyReturnBps;

    /// @notice Minimum daily return (30 = 0.3%).
    uint256 public minDailyReturnBps;

    /// @notice Maximum daily return (120 = 1.2%).
    uint256 public maxDailyReturnBps;

    /// @notice Kelly fraction (bps, default 2500 = 25%).
    uint256 public kellyFractionBps;

    /// @notice Lock period in seconds (default 7 days).
    uint256 public lockPeriod;

    /// @notice Emergency withdrawal penalty in bps (default 1000 = 10%).
    uint256 public emergencyPenaltyBps;

    // ─── Stop-loss ──────────────────────────────────────────────
    uint256 public consecutiveLossDays;
    bool    public stopLossActive;

    // ─── Daily tracking ────────────────────────────────────────
    struct DailyReport {
        uint256 date;
        int256  pnl;
        uint256 totalManaged;
        uint256 returnBps;
    }
    DailyReport[] public dailyReports;

    uint256 public currentDayDate;
    int256  public currentDayPL;
    uint256 public totalManaged; // sum of all user managedAmounts
    uint256 public totalDeposited;

    // ─── Events ─────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 penalty);
    event EmergencyWithdrawn(address indexed user, uint256 amount, uint256 penalty);
    event DailySettled(uint256 date, int256 pnl, uint256 totalManaged, uint256 returnBps);
    event StopLossTriggered(uint256 consecutiveLosses);
    event StopLossCleared();
    event ParamsUpdated(uint256 dailyReturnBps, uint256 kellyFractionBps, uint256 lockPeriod);

    // ─── Constructor ────────────────────────────────────────────
    constructor() {
        _disableInitializers();
    }

    // ─── Initializer ────────────────────────────────────────────
    function initialize(address _pool) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();

        pool = LuckyPool(_pool);

        dailyReturnBps      = 60;    // 0.6%
        minDailyReturnBps   = 30;    // 0.3%
        maxDailyReturnBps   = 120;   // 1.2%
        kellyFractionBps    = 2500;  // 25%
        lockPeriod          = 7 days;
        emergencyPenaltyBps = 1000;  // 10%

        currentDayDate = _dayStart(block.timestamp);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── Modifiers ──────────────────────────────────────────────
    modifier whenNotStopped() {
        require(!stopLossActive, "AIVault: stop-loss active");
        _;
    }

    // ─── Admin: set parameters ──────────────────────────────────
    function setDailyReturn(uint256 _bps) external onlyOwner {
        require(_bps >= minDailyReturnBps && _bps <= maxDailyReturnBps, "AIVault: out of range");
        dailyReturnBps = _bps;
        emit ParamsUpdated(_bps, kellyFractionBps, lockPeriod);
    }

    function setKellyFraction(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "AIVault: max 100%");
        kellyFractionBps = _bps;
        emit ParamsUpdated(dailyReturnBps, _bps, lockPeriod);
    }

    function setLockPeriod(uint256 _seconds) external onlyOwner {
        require(_seconds <= 30 days, "AIVault: max 30 days");
        lockPeriod = _seconds;
        emit ParamsUpdated(dailyReturnBps, kellyFractionBps, _seconds);
    }

    function setEmergencyPenalty(uint256 _bps) external onlyOwner {
        require(_bps <= 5000, "AIVault: max 50%");
        emergencyPenaltyBps = _bps;
    }

    function setReturnBounds(uint256 _minBps, uint256 _maxBps) external onlyOwner {
        require(_minBps <= _maxBps && _maxBps <= 500, "AIVault: max 5%"); // 500 bps = 5%
        minDailyReturnBps = _minBps;
        maxDailyReturnBps = _maxBps;
        // Clamp current dailyReturnBps if outside new bounds
        if (dailyReturnBps < _minBps) dailyReturnBps = _minBps;
        if (dailyReturnBps > _maxBps) dailyReturnBps = _maxBps;
    }

    // ─── Deposit ────────────────────────────────────────────────
    /// @notice Deposit USDT into the AI vault for management.
    function deposit(uint256 _amount) external whenNotPaused whenNotStopped nonReentrant {
        require(_amount >= MIN_MANAGED, "AIVault: below minimum");
        require(pool.userBalance(msg.sender) >= _amount, "AIVault: insufficient pool balance");

        Position storage pos = positions[msg.sender];

        uint256 newManaged = pos.managedAmount + _amount;
        require(newManaged <= MAX_MANAGED, "AIVault: exceeds max managed");

        // Deduct from LuckyPool user balance
        pool.recordBet(msg.sender, _amount);

        pos.deposited += _amount;
        pos.managedAmount = newManaged;
        pos.lockUntil = block.timestamp + lockPeriod;
        pos.lastSettleDay = _dayStart(block.timestamp);
        pos.active = true;

        totalManaged += _amount;
        totalDeposited += _amount;

        emit Deposited(msg.sender, _amount);
    }

    // ─── Withdraw (normal, after lock period) ───────────────────
    function withdraw(uint256 _amount) external whenNotPaused nonReentrant {
        Position storage pos = positions[msg.sender];
        require(pos.active, "AIVault: no position");
        require(_amount <= pos.managedAmount, "AIVault: exceeds managed");
        require(block.timestamp >= pos.lockUntil, "AIVault: funds locked");

        pos.managedAmount -= _amount;
        totalManaged -= _amount;

        if (pos.managedAmount == 0) {
            pos.active = false;
        }

        // Return to LuckyPool user balance
        pool.recordPayout(msg.sender, _amount);

        emit Withdrawn(msg.sender, _amount, 0);
    }

    // ─── Emergency withdrawal (with penalty) ────────────────────
    /// @notice Withdraw before lock period expires — penalty deducted.
    function emergencyWithdraw() external whenNotPaused nonReentrant {
        Position storage pos = positions[msg.sender];
        require(pos.active, "AIVault: no position");
        require(pos.managedAmount > 0, "AIVault: nothing to withdraw");

        // Apply penalty if still locked
        uint256 amount = pos.managedAmount;
        uint256 penalty = 0;

        if (block.timestamp < pos.lockUntil) {
            penalty = amount * emergencyPenaltyBps / BPS_DENOMINATOR;
        }

        uint256 netAmount = amount - penalty;

        pos.managedAmount = 0;
        pos.active = false;
        totalManaged -= amount;

        // Return net amount to user, penalty stays in pool
        pool.recordPayout(msg.sender, netAmount);

        // Record penalty as revenue
        if (penalty > 0) {
            pool.recordRevenue(penalty);
        }

        emit EmergencyWithdrawn(msg.sender, netAmount, penalty);
    }

    // ─── Daily settlement ───────────────────────────────────────
    /// @notice Process daily returns for all users (must be called once per day).
    ///         In production, this is batched or done per-user on interaction.
    ///         For simplicity, individual settlement.
    function settleDaily(address _user) external {
        _resetDailyIfNeeded();
        _settleUser(_user);
    }

    /// @notice Batch settle multiple users.
    function batchSettleDaily(address[] calldata _users) external {
        _resetDailyIfNeeded();
        for (uint256 i = 0; i < _users.length; i++) {
            _settleUser(_users[i]);
        }
    }

    function _settleUser(address _user) internal whenNotStopped {
        Position storage pos = positions[_user];
        if (!pos.active || pos.managedAmount == 0) return;

        uint256 today = _dayStart(block.timestamp);
        if (pos.lastSettleDay >= today) return; // already settled today

        // Calculate daily return
        uint256 dailyReturn = pos.managedAmount * dailyReturnBps / BPS_DENOMINATOR;

        // Kelly formula position sizing:
        //   f* = (bp - q) / b
        //   where b = odds received, p = win probability, q = 1-p
        // Simplified: kelly-adjusted return = dailyReturn * kellyFraction / 10000
        uint256 kellyReturn = dailyReturn * kellyFractionBps / BPS_DENOMINATOR;

        if (kellyReturn > 0) {
            pos.managedAmount += kellyReturn;
            pos.cumulativeReturn += kellyReturn;
            totalManaged += kellyReturn;
            currentDayPL += int256(kellyReturn);

            // Track consecutive wins/losses for stop-loss
            consecutiveLossDays = 0; // profit day — reset
        } else {
            currentDayPL -= int256(dailyReturn);
            consecutiveLossDays++;

            // Stop-loss after N consecutive loss days
            if (consecutiveLossDays >= MAX_CONSECUTIVE_LOSSES) {
                stopLossActive = true;
                _pause();
                emit StopLossTriggered(consecutiveLossDays);
            }
        }

        pos.lastSettleDay = today;
    }

    // ─── Admin: manual settlement ───────────────────────────────
    /// @notice Owner can record a custom PnL for a user (loss or profit).
    function recordUserPnL(address _user, int256 _pnl) external onlyOwner {
        Position storage pos = positions[_user];
        require(pos.active, "AIVault: no position");

        if (_pnl > 0) {
            uint256 profit = uint256(_pnl);
            pos.managedAmount += profit;
            pos.cumulativeReturn += profit;
            totalManaged += profit;
            consecutiveLossDays = 0;
        } else if (_pnl < 0) {
            uint256 loss = uint256(-_pnl);
            require(loss <= pos.managedAmount, "AIVault: loss exceeds managed");
            pos.managedAmount -= loss;
            totalManaged -= loss;
            consecutiveLossDays++;

            if (consecutiveLossDays >= MAX_CONSECUTIVE_LOSSES) {
                stopLossActive = true;
                _pause();
                emit StopLossTriggered(consecutiveLossDays);
            }
        }

        pos.lastSettleDay = _dayStart(block.timestamp);
        currentDayPL += _pnl;
    }

    // ─── Admin: clear stop-loss ─────────────────────────────────
    function clearStopLoss() external onlyOwner {
        require(stopLossActive, "AIVault: not stopped");
        stopLossActive = false;
        consecutiveLossDays = 0;
        if (paused()) {
            _unpause();
        }
        emit StopLossCleared();
    }

    // ─── Admin: add revenue ─────────────────────────────────────
    /// @notice Add profit from external trading to the pool.
    function addRevenue(uint256 _amount) external onlyOwner {
        require(pool.poolBalance() >= 0, "AIVault: pool error");
        pool.recordRevenue(_amount);
    }

    // ─── View helpers ────────────────────────────────────────────
    function getPosition(address _user)
        external
        view
        returns (
            uint256 deposited,
            uint256 managed,
            uint256 pendingWithdraw,
            uint256 lockUntil,
            uint256 cumulativeReturn,
            bool active
        )
    {
        Position storage pos = positions[_user];
        return (pos.deposited, pos.managedAmount, pos.pendingWithdraw,
                pos.lockUntil, pos.cumulativeReturn, pos.active);
    }

    function getKellySize(uint256 _managedAmount, uint256 _estimatedReturnBps)
        external
        view
        returns (uint256 kellyPosition)
    {
        // Kelly: f* = (b*p - q) / b, simplified to fraction of managed
        kellyPosition = _managedAmount * _estimatedReturnBps * kellyFractionBps
                        / BPS_DENOMINATOR / BPS_DENOMINATOR;
    }

    function getDailyReportCount() external view returns (uint256) {
        return dailyReports.length;
    }

    function getStatus()
        external
        view
        returns (
            uint256 _totalManaged,
            uint256 _totalDeposited,
            uint256 _dailyReturnBps,
            uint256 _consecutiveLosses,
            bool _stopLossActive,
            bool _paused
        )
    {
        return (totalManaged, totalDeposited, dailyReturnBps,
                consecutiveLossDays, stopLossActive, paused());
    }

    // ─── Internal ────────────────────────────────────────────────
    function _resetDailyIfNeeded() internal {
        uint256 today = _dayStart(block.timestamp);
        if (today > currentDayDate) {
            dailyReports.push(DailyReport({
                date: today - 1 days,
                pnl: currentDayPL,
                totalManaged: totalManaged,
                returnBps: dailyReturnBps
            }));
            emit DailySettled(today - 1 days, currentDayPL, totalManaged, dailyReturnBps);

            currentDayDate = today;
            currentDayPL = 0;
        }
    }

    function _dayStart(uint256 _timestamp) internal pure returns (uint256) {
        return (_timestamp / 1 days) * 1 days;
    }
}
