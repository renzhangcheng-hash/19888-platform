// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./LuckyPool.sol";

/// @title AntiScoreBet — 反波膽 (anti-score betting)
/// @notice Players bet AGAINST specific scores — they win if the final score
///         is NOT the score they bet against. 18-grid system: 16 home scores
///         plus home4+ and away4+. Win rate: ~88.89% (16/18 grids cover).
///
///         18-grid score layout (cell index 0–17):
///         0:0  0:1  0:2  0:3
///         1:0  1:1  1:2  1:3
///         2:0  2:1  2:2  2:3
///         3:0  3:1  3:2  3:3
///         home4+  away4+
///
///         Odds derived from 27-year historical database model.
///         Bet limits: 100–5,000 USDT per score cell.
///         Auto risk control pauses high-exposure cells.
contract AntiScoreBet is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable
{
    // ─── Reentrancy guard ───────────────────────────────────────
    uint256 private _status;
    modifier nonReentrant() {
        require(_status == 0, "AntiScoreBet: reentrant call");
        _status = 1;
        _;
        _status = 0;
    }
    LuckyPool public pool;

    // ─── Constants ──────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint8   public constant GRID_COUNT       = 18;
    uint256 public constant MIN_BET          = 100 ether;   // 100 USDT
    uint256 public constant MAX_BET          = 5000 ether;  // 5,000 USDT

    // ─── Data structures ────────────────────────────────────────
    struct Match {
        uint256 id;
        string  home;
        string  away;
        uint256 startTime;
        uint256 endTime;           // betting closes at startTime
        uint8   finalCell;         // settled result cell index (0-17), 255 = unsettled
        bool    settled;
        uint256 totalBets;         // total amount bet on this match
        bool    active;
    }

    struct Bet {
        address user;
        uint256 matchId;
        uint8   cellIndex;         // which cell the user bet AGAINST
        uint256 amount;
        uint256 odds;              // in bps (e.g., 11250 = 1.125x = 12.5% profit)
        uint256 potentialWin;      // amount * odds / 10000
        bool    settled;
        bool    won;               // true if final score != this cell
        uint256 payout;
        uint256 placedAt;          // timestamp
    }

    // ─── Storage ────────────────────────────────────────────────
    mapping(uint256 => Match) public matches;
    mapping(uint256 => Bet)   public bets;
    uint256 public matchCount;
    uint256 public betCount;

    /// @notice Per-match, per-cell total exposure: cellExposure[matchId][cellIndex]
    mapping(uint256 => mapping(uint8 => uint256)) public cellExposure;

    /// @notice Per-cell odds in bps (set by owner based on 27-year DB model).
    ///         Default: equal odds for all cells.
    mapping(uint8 => uint256) public cellOddsBps;

    /// @notice Max exposure per cell before auto-pause (in USDT).
    uint256 public cellExposureLimit;

    /// @notice Paused cells: cellPaused[matchId][cellIndex]
    mapping(uint256 => mapping(uint8 => bool)) public cellPaused;

    // ─── Events ─────────────────────────────────────────────────
    event MatchCreated(uint256 indexed matchId, string home, string away, uint256 startTime);
    event BetPlaced(uint256 indexed betId, address indexed user, uint256 matchId, uint8 cell, uint256 amount, uint256 odds);
    event MatchSettled(uint256 indexed matchId, uint8 finalCell);
    event BetSettled(uint256 indexed betId, bool won, uint256 payout);
    event CellPaused(uint256 indexed matchId, uint8 cell);
    event CellUnpaused(uint256 indexed matchId, uint8 cell);
    event CellOddsUpdated(uint8 cell, uint256 oddsBps);
    event CellExposureLimitUpdated(uint256 newLimit);

    // ─── Constructor ────────────────────────────────────────────
    constructor() {
        _disableInitializers();
    }

    // ─── Initializer ────────────────────────────────────────────
    function initialize(address _pool) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();

        pool = LuckyPool(_pool);

        // Default per-cell exposure limit: 50,000 USDT
        cellExposureLimit = 50000 ether;

        // Set default odds for all 18 cells (11250 bps = 1.125x = 12.5% net profit).
        // This reflects the 88.89% win rate house edge:
        //   17/18 win probability → fair odds ~10588 bps.
        //   Platform offers ~11250 bps for a ~6% house edge.
        _setDefaultOdds();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── Modifiers ──────────────────────────────────────────────
    modifier matchExists(uint256 _matchId) {
        require(matches[_matchId].active, "AntiScoreBet: match not found");
        _;
    }

    modifier matchOpen(uint256 _matchId) {
        Match storage m = matches[_matchId];
        require(m.active, "AntiScoreBet: match not found");
        require(block.timestamp < m.startTime, "AntiScoreBet: betting closed");
        require(!m.settled, "AntiScoreBet: match settled");
        _;
    }

    // ─── Default odds ────────────────────────────────────────────
    function _setDefaultOdds() internal {
        // Default 11250 bps for all 18 cells
        for (uint8 i = 0; i < GRID_COUNT; i++) {
            cellOddsBps[i] = 11250; // 1.125x
        }
    }

    /// @notice Set odds for a specific cell (in bps). e.g., 11250 = 1.125x.
    function setCellOdds(uint8 _cell, uint256 _oddsBps) external onlyOwner {
        require(_cell < GRID_COUNT, "AntiScoreBet: invalid cell");
        require(_oddsBps >= 10000 && _oddsBps <= 50000, "AntiScoreBet: odds out of range");
        cellOddsBps[_cell] = _oddsBps;
        emit CellOddsUpdated(_cell, _oddsBps);
    }

    /// @notice Batch set odds for all 18 cells.
    function setAllCellOdds(uint256[GRID_COUNT] calldata _oddsBps) external onlyOwner {
        for (uint8 i = 0; i < GRID_COUNT; i++) {
            require(_oddsBps[i] >= 10000 && _oddsBps[i] <= 50000, "AntiScoreBet: odds out of range");
            cellOddsBps[i] = _oddsBps[i];
            emit CellOddsUpdated(i, _oddsBps[i]);
        }
    }

    // ─── Cell exposure limit ────────────────────────────────────
    function setCellExposureLimit(uint256 _limit) external onlyOwner {
        cellExposureLimit = _limit;
        emit CellExposureLimitUpdated(_limit);
    }

    // ─── Match management ───────────────────────────────────────
    function createMatch(
        uint256 _id,
        string calldata _home,
        string calldata _away,
        uint256 _startTime
    ) external onlyOwner {
        require(!matches[_id].active, "AntiScoreBet: match exists");
        require(_startTime > block.timestamp, "AntiScoreBet: start in past");

        Match storage m = matches[_id];
        m.id        = _id;
        m.home      = _home;
        m.away      = _away;
        m.startTime = _startTime;
        m.endTime   = _startTime;
        m.finalCell = 255; // unsettled sentinel
        m.active    = true;

        matchCount++;
        emit MatchCreated(_id, _home, _away, _startTime);
    }

    // ─── Place bet ──────────────────────────────────────────────
    /// @notice Place an anti-score bet: the user bets that _cellIndex will NOT be
    ///         the final score. They win if finalCell != _cellIndex.
    function placeBet(
        uint256 _matchId,
        uint8   _cellIndex,
        uint256 _amount
    )
        external
        whenNotPaused
        matchOpen(_matchId)
        nonReentrant
    {
        require(_cellIndex < GRID_COUNT, "AntiScoreBet: invalid cell");
        require(_amount >= MIN_BET, "AntiScoreBet: below minimum");
        require(_amount <= MAX_BET, "AntiScoreBet: above maximum");
        require(!cellPaused[_matchId][_cellIndex], "AntiScoreBet: cell paused");

        // Check user has sufficient pool balance
        require(pool.userBalance(msg.sender) >= _amount, "AntiScoreBet: insufficient balance");

        // Deduct from pool
        pool.recordBet(msg.sender, _amount);

        // Track exposure, auto-pause if limit exceeded
        uint256 newExposure = cellExposure[_matchId][_cellIndex] + _amount;
        if (newExposure > cellExposureLimit) {
            cellPaused[_matchId][_cellIndex] = true;
            emit CellPaused(_matchId, _cellIndex);
            revert("AntiScoreBet: cell exposure limit exceeded");
        }
        cellExposure[_matchId][_cellIndex] = newExposure;

        uint256 odds = cellOddsBps[_cellIndex];
        uint256 potentialWin = _amount * odds / BPS_DENOMINATOR;

        betCount++;
        Bet storage b = bets[betCount];
        b.user         = msg.sender;
        b.matchId      = _matchId;
        b.cellIndex    = _cellIndex;
        b.amount       = _amount;
        b.odds         = odds;
        b.potentialWin = potentialWin;
        b.placedAt     = block.timestamp;

        matches[_matchId].totalBets += _amount;

        emit BetPlaced(betCount, msg.sender, _matchId, _cellIndex, _amount, odds);
    }

    // ─── Settle match ────────────────────────────────────────────
    /// @notice Set the final score for a match (cell index 0-17).
    function settleMatch(uint256 _matchId, uint8 _finalCell) external onlyOwner matchExists(_matchId) {
        Match storage m = matches[_matchId];
        require(!m.settled, "AntiScoreBet: already settled");
        require(_finalCell < GRID_COUNT, "AntiScoreBet: invalid final cell");

        m.finalCell = _finalCell;
        m.settled   = true;
        m.active    = false;

        emit MatchSettled(_matchId, _finalCell);
    }

    // ─── Settle individual bet ──────────────────────────────────
    /// @notice Settle a single bet after match is settled.
    function settleBet(uint256 _betId) external onlyOwner {
        Bet storage b = bets[_betId];
        require(!b.settled, "AntiScoreBet: bet already settled");

        Match storage m = matches[b.matchId];
        require(m.settled, "AntiScoreBet: match not settled");

        b.settled = true;

        // User wins if the final cell is NOT the cell they bet against
        if (m.finalCell != b.cellIndex) {
            b.won    = true;
            b.payout = b.potentialWin;

            // Pay out from pool
            pool.recordPayout(b.user, b.payout);
        } else {
            b.won    = false;
            b.payout = 0;
            // Amount already deducted — stays in pool as platform profit
        }

        emit BetSettled(_betId, b.won, b.payout);
    }

    /// @notice Batch settle multiple bets. Gas-optimized for post-match settlement.
    function settleBets(uint256[] calldata _betIds) external onlyOwner {
        for (uint256 i = 0; i < _betIds.length; i++) {
            this.settleBet(_betIds[i]);
        }
    }

    // ─── Cell pausing (admin) ───────────────────────────────────
    function pauseCell(uint256 _matchId, uint8 _cell) external onlyOwner {
        require(_cell < GRID_COUNT, "AntiScoreBet: invalid cell");
        cellPaused[_matchId][_cell] = true;
        emit CellPaused(_matchId, _cell);
    }

    function unpauseCell(uint256 _matchId, uint8 _cell) external onlyOwner {
        require(_cell < GRID_COUNT, "AntiScoreBet: invalid cell");
        cellPaused[_matchId][_cell] = false;
        emit CellUnpaused(_matchId, _cell);
    }

    // ─── View helpers ────────────────────────────────────────────
    function getCellExposures(uint256 _matchId) external view returns (uint256[GRID_COUNT] memory exposures) {
        for (uint8 i = 0; i < GRID_COUNT; i++) {
            exposures[i] = cellExposure[_matchId][i];
        }
    }

    function getCellStatus(uint256 _matchId) external view returns (bool[GRID_COUNT] memory paused) {
        for (uint8 i = 0; i < GRID_COUNT; i++) {
            paused[i] = cellPaused[_matchId][i];
        }
    }

    /// @notice Get human-readable score string for a cell index.
    function cellToScore(uint8 _cell) public pure returns (string memory) {
        require(_cell < GRID_COUNT, "AntiScoreBet: invalid cell");
        if (_cell == 16) return "home4+";
        if (_cell == 17) return "away4+";

        uint8 home = _cell / 4;   // 0-3
        uint8 away = _cell % 4;   // 0-3

        return string.concat(
            _uintToString(home), ":", _uintToString(away)
        );
    }

    function _uintToString(uint8 _v) internal pure returns (string memory) {
        if (_v == 0) return "0";
        if (_v == 1) return "1";
        if (_v == 2) return "2";
        if (_v == 3) return "3";
        return "?";
    }
}
