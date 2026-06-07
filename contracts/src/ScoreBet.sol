// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./LuckyPool.sol";

/// @title ScoreBet — 正波膽 (correct score betting)
/// @notice Traditional correct score betting on the 18-grid system.
///         Players bet that a specific score WILL be the final result.
///         High odds: 765% (7.65x) to 42,500% (425x for 4:0).
///
///         18-grid score layout (cell index 0–17):
///         0:0  0:1  0:2  0:3
///         1:0  1:1  1:2  1:3
///         2:0  2:1  2:2  2:3
///         3:0  3:1  3:2  3:3
///         home4+  away4+
///
///         Auto-pause high-odds scores if pool at risk.
contract ScoreBet is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable
{
    // ─── Reentrancy guard ───────────────────────────────────────
    uint256 private _status;
    modifier nonReentrant() {
        require(_status == 0, "ScoreBet: reentrant call");
        _status = 1;
        _;
        _status = 0;
    }
    LuckyPool public pool;

    // ─── Constants ──────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint8   public constant GRID_COUNT       = 18;

    /// @notice Odds tiers (in bps). e.g. 42500 = 425x = 42,500%.
    ///         Index mapping: 0=routine scores, 1=unlikely, 2=very unlikely, 3=extreme
    uint256[GRID_COUNT] public cellOddsBps;

    // ─── Bet limits ─────────────────────────────────────────────
    uint256 public minBet; // default 10 USDT
    uint256 public maxBet; // default 1000 USDT

    // ─── Data structures ─────────────────────────────────────────
    struct Match {
        uint256 id;
        string  home;
        string  away;
        uint256 startTime;
        uint8   finalCell;       // settled result (0-17), 255 = unsettled
        bool    settled;
        bool    active;
    }

    struct Bet {
        address user;
        uint256 matchId;
        uint8   cellIndex;       // which score the user bet ON
        uint256 amount;
        uint256 odds;            // in bps
        uint256 potentialWin;    // amount * odds / 10000
        bool    settled;
        bool    won;
        uint256 payout;
        uint256 placedAt;
    }

    // ─── Storage ────────────────────────────────────────────────
    mapping(uint256 => Match) public matches;
    mapping(uint256 => Bet)   public bets;
    uint256 public matchCount;
    uint256 public betCount;

    /// @notice Per-match, per-cell total exposure
    mapping(uint256 => mapping(uint8 => uint256)) public cellExposure;

    /// @notice Cells paused due to pool risk
    mapping(uint256 => mapping(uint8 => bool)) public cellPaused;

    /// @notice Max payout per cell as fraction of pool (in bps)
    uint256 public maxCellPayoutBps;

    // ─── Events ─────────────────────────────────────────────────
    event MatchCreated(uint256 indexed matchId, string home, string away, uint256 startTime);
    event BetPlaced(uint256 indexed betId, address indexed user, uint256 matchId, uint8 cell, uint256 amount, uint256 odds);
    event MatchSettled(uint256 indexed matchId, uint8 finalCell);
    event BetSettled(uint256 indexed betId, bool won, uint256 payout);
    event CellPaused(uint256 indexed matchId, uint8 cell);
    event CellUnpaused(uint256 indexed matchId, uint8 cell);
    event OddsUpdated(uint8 cell, uint256 oddsBps);

    // ─── Constructor ────────────────────────────────────────────
    constructor() {
        _disableInitializers();
    }

    // ─── Initializer ────────────────────────────────────────────
    function initialize(address _pool) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();

        pool = LuckyPool(_pool);

        minBet = 10 ether;   // 10 USDT
        maxBet = 1000 ether; // 1,000 USDT

        maxCellPayoutBps = 2000; // 20% of pool max payout per cell

        _setDefaultOdds();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── Modifiers ──────────────────────────────────────────────
    modifier matchExists(uint256 _matchId) {
        require(matches[_matchId].active, "ScoreBet: match not found");
        _;
    }

    modifier matchOpen(uint256 _matchId) {
        Match storage m = matches[_matchId];
        require(m.active, "ScoreBet: match not found");
        require(block.timestamp < m.startTime, "ScoreBet: betting closed");
        require(!m.settled, "ScoreBet: match settled");
        _;
    }

    // ─── Default odds (18-grid, risk-based tiers) ───────────────
    function _setDefaultOdds() internal {
        // Tier 1 — routine scores: 765% (7.65x)
        cellOddsBps[0]  = 765;   // 0:0
        cellOddsBps[1]  = 765;   // 0:1
        cellOddsBps[4]  = 765;   // 1:0
        cellOddsBps[5]  = 765;   // 1:1

        // Tier 2 — moderate: 1,500% (15x)
        cellOddsBps[2]  = 1500;  // 0:2
        cellOddsBps[3]  = 2500;  // 0:3
        cellOddsBps[6]  = 1500;  // 1:2
        cellOddsBps[7]  = 2500;  // 1:3
        cellOddsBps[8]  = 1500;  // 2:0
        cellOddsBps[9]  = 2500;  // 2:1
        cellOddsBps[12] = 2500;  // 3:0
        cellOddsBps[13] = 3500;  // 3:1

        // Tier 3 — unlikely: 10,000% (100x)
        cellOddsBps[10] = 10000; // 2:2
        cellOddsBps[11] = 12000; // 2:3
        cellOddsBps[14] = 12000; // 3:2
        cellOddsBps[15] = 15000; // 3:3

        // Tier 4 — extreme: 42,500% (425x)
        cellOddsBps[16] = 42500; // home4+
        cellOddsBps[17] = 42500; // away4+
    }

    // ─── Admin: set odds ────────────────────────────────────────
    function setCellOdds(uint8 _cell, uint256 _oddsBps) external onlyOwner {
        require(_cell < GRID_COUNT, "ScoreBet: invalid cell");
        require(_oddsBps >= 100 && _oddsBps <= 100000, "ScoreBet: odds out of range");
        cellOddsBps[_cell] = _oddsBps;
        emit OddsUpdated(_cell, _oddsBps);
    }

    function setAllCellOdds(uint256[GRID_COUNT] calldata _oddsBps) external onlyOwner {
        for (uint8 i = 0; i < GRID_COUNT; i++) {
            require(_oddsBps[i] >= 100 && _oddsBps[i] <= 100000, "ScoreBet: odds out of range");
            cellOddsBps[i] = _oddsBps[i];
            emit OddsUpdated(i, _oddsBps[i]);
        }
    }

    function setBetLimits(uint256 _minBet, uint256 _maxBet) external onlyOwner {
        require(_minBet <= _maxBet, "ScoreBet: invalid range");
        minBet = _minBet;
        maxBet = _maxBet;
    }

    function setMaxCellPayoutBps(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "ScoreBet: max 100%");
        maxCellPayoutBps = _bps;
    }

    // ─── Match management ───────────────────────────────────────
    function createMatch(
        uint256 _id,
        string calldata _home,
        string calldata _away,
        uint256 _startTime
    ) external onlyOwner {
        require(!matches[_id].active, "ScoreBet: match exists");
        require(_startTime > block.timestamp, "ScoreBet: start in past");

        Match storage m = matches[_id];
        m.id        = _id;
        m.home      = _home;
        m.away      = _away;
        m.startTime = _startTime;
        m.finalCell = 255;
        m.active    = true;

        matchCount++;
        emit MatchCreated(_id, _home, _away, _startTime);
    }

    // ─── Place bet ──────────────────────────────────────────────
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
        require(_cellIndex < GRID_COUNT, "ScoreBet: invalid cell");
        require(_amount >= minBet, "ScoreBet: below minimum");
        require(_amount <= maxBet, "ScoreBet: above maximum");
        require(!cellPaused[_matchId][_cellIndex], "ScoreBet: cell paused");

        require(pool.userBalance(msg.sender) >= _amount, "ScoreBet: insufficient balance");

        uint256 odds = cellOddsBps[_cellIndex];
        uint256 potentialWin = _amount * odds / BPS_DENOMINATOR;

        // Check pool can cover this payout
        uint256 poolBal = pool.poolBalance();
        require(potentialWin <= poolBal * maxCellPayoutBps / BPS_DENOMINATOR,
            "ScoreBet: payout exceeds pool safety limit");

        // Auto-pause cell if new exposure puts pool at risk
        uint256 newCellExposure = cellExposure[_matchId][_cellIndex] + potentialWin;
        if (newCellExposure > poolBal * maxCellPayoutBps / BPS_DENOMINATOR) {
            cellPaused[_matchId][_cellIndex] = true;
            emit CellPaused(_matchId, _cellIndex);
            revert("ScoreBet: cell paused due to pool risk");
        }

        // Deduct from pool
        pool.recordBet(msg.sender, _amount);

        cellExposure[_matchId][_cellIndex] = newCellExposure;

        betCount++;
        Bet storage b = bets[betCount];
        b.user         = msg.sender;
        b.matchId      = _matchId;
        b.cellIndex    = _cellIndex;
        b.amount       = _amount;
        b.odds         = odds;
        b.potentialWin = potentialWin;
        b.placedAt     = block.timestamp;

        emit BetPlaced(betCount, msg.sender, _matchId, _cellIndex, _amount, odds);
    }

    // ─── Settle match ────────────────────────────────────────────
    function settleMatch(uint256 _matchId, uint8 _finalCell) external onlyOwner matchExists(_matchId) {
        Match storage m = matches[_matchId];
        require(!m.settled, "ScoreBet: already settled");
        require(_finalCell < GRID_COUNT, "ScoreBet: invalid final cell");

        m.finalCell = _finalCell;
        m.settled   = true;
        m.active    = false;

        emit MatchSettled(_matchId, _finalCell);
    }

    // ─── Settle individual bet ──────────────────────────────────
    function settleBet(uint256 _betId) external onlyOwner {
        Bet storage b = bets[_betId];
        require(!b.settled, "ScoreBet: bet already settled");

        Match storage m = matches[b.matchId];
        require(m.settled, "ScoreBet: match not settled");

        b.settled = true;

        // User wins if they bet on the correct score
        if (m.finalCell == b.cellIndex) {
            b.won    = true;
            b.payout = b.potentialWin;
            pool.recordPayout(b.user, b.payout);
        } else {
            b.won    = false;
            b.payout = 0;
        }

        emit BetSettled(_betId, b.won, b.payout);
    }

    function settleBets(uint256[] calldata _betIds) external onlyOwner {
        for (uint256 i = 0; i < _betIds.length; i++) {
            this.settleBet(_betIds[i]);
        }
    }

    // ─── Cell pausing ───────────────────────────────────────────
    function pauseCell(uint256 _matchId, uint8 _cell) external onlyOwner {
        require(_cell < GRID_COUNT, "ScoreBet: invalid cell");
        cellPaused[_matchId][_cell] = true;
        emit CellPaused(_matchId, _cell);
    }

    function unpauseCell(uint256 _matchId, uint8 _cell) external onlyOwner {
        require(_cell < GRID_COUNT, "ScoreBet: invalid cell");
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

    function cellToScore(uint8 _cell) public pure returns (string memory) {
        require(_cell < GRID_COUNT, "ScoreBet: invalid cell");
        if (_cell == 16) return "home4+";
        if (_cell == 17) return "away4+";
        uint8 home = _cell / 4;
        uint8 away = _cell % 4;
        return string.concat(_uintToString(home), ":", _uintToString(away));
    }

    function _uintToString(uint8 _v) internal pure returns (string memory) {
        if (_v == 0) return "0";
        if (_v == 1) return "1";
        if (_v == 2) return "2";
        if (_v == 3) return "3";
        return "?";
    }
}
