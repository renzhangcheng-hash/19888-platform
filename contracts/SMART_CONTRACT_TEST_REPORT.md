# 19888 Smart Contract Test Report
**Date:** 2026-06-07 | **Network:** Sepolia (chain 11155111) | **Deployer:** 0x2D7fD65f2Ebb74EF91c1Cc27CEdb0eBaC2FdbbA6

---

## 1. FOUNDRY TEST RESULTS: ALL PASSED

**23 tests, 0 failed, 0 skipped across 8 test suites** (execution time: 20.90ms)

| Test Suite | Tests | Gas | Results |
|---|---|---|---|
| LuckyPoolTest | 3 | deposit:152K, withdraw:179K, circuitBreaker:202K | 3/3 PASS |
| AntiScoreBetTest | 1 | placeBet: 490K | 1/1 PASS |
| ChampionBetTest | 2 | placeBet:346K, settle:444K | 2/2 PASS |
| ScoreBetTest | 4 | placeBet:329K, settle:353K, +failure tests | 4/4 PASS |
| AIVaultTest | 3 | addRevenue:82K, getAPR:13K, +access control | 3/3 PASS |
| RevenueShareTest | 4 | collectFee:41K, setShares:43K, +failure tests | 4/4 PASS |
| VIPStakingTest | 4 | stake:117K, unstake:125K, +failure tests | 4/4 PASS |
| CounterTest | 2 | fuzz (256 runs), increment | 2/2 PASS |

---

## 2. ON-CHAIN VERIFICATION

### 2.1 Contract Code Verification

| # | Contract | Address | Has Code | Type | owner() | Pass |
|---|---|---|---|---|---|---|
| 1 | MockUSDT | 0x98f160...083cf | YES | Standalone | N/A (no owner fn) | PASS |
| 2 | LuckyPool | 0x02fda9...e9DA | YES | ERC1967 Proxy | 0x2D7f...bbA6 | PASS |
| 3 | AntiScoreBet | 0x865C5C...97aD | YES | ERC1967 Proxy | 0x2D7f...bbA6 | PASS |
| 4 | ScoreBet | 0xfFd6f4...9094 | YES | ERC1967 Proxy | **0x0000...0000** | **FAIL** |
| 5 | ChampionBet | 0x938246...ED71 | YES | ERC1967 Proxy | 0x2D7f...bbA6 | PASS |
| 6 | AIVault | 0x238568...aeb0 | YES | ERC1967 Proxy | 0x2D7f...bbA6 | PASS |
| 7 | RevenueShare | 0xCe660a...1eeB | YES | ERC1967 Proxy | 0x2D7f...bbA6 | PASS |
| 8 | VIPStaking | 0x5CDA18...45b8 | YES | ERC1967 Proxy | 0x2D7f...bbA6 | PASS |

### 2.2 On-Chain State Verification

| Contract | State Variables | Values |
|---|---|---|
| MockUSDT | name, symbol, balanceOf(deployer) | "Test USDT", "tUSDT", 999,950 USDT |
| LuckyPool | poolBalance, totalDeposits, circuitBreaker, paused | 50 USDT, 100 USDT, false, false |
| ChampionBet | betCount, resultSet | 0, false |
| AIVault | totalRevenue | 0 |
| RevenueShare | agentShare | 3000 (30%) |
| VIPStaking | totalStaked | 0 |

All contracts are accessible and have expected initial state. Deployer has deposited and withdrawn from LuckyPool (50 USDT net balance remaining, 100 USDT total deposits, 50 USDT withdrawn).

---

## 3. SECURITY AUDIT

### 3.1 CRITICAL: ScoreBet Owner Not Initialized

**Severity: CRITICAL**

`ScoreBet.sol` line 20-22:
```solidity
function initialize(address _pool) public initializer {
    pool = LuckyPool(_pool);
}
```

The `initialize()` function does NOT call `__Ownable_init(msg.sender)`. Per OpenZeppelin UUPSUpgradeable, `OwnableUpgradeable.__Ownable_init()` MUST be called manually. This means:

- `owner()` returns `address(0)` permanently
- `settleBet()` has `onlyOwner` modifier → **uncallable** (no one can sign as address(0))
- `_authorizeUpgrade()` has `onlyOwner` modifier → **proxy cannot be upgraded**
- **This is PERMANENT and UNFIXABLE** — the proxy can never be upgraded to fix it because upgrade authorization requires the owner

Every other contract (LuckyPool, AntiScoreBet, ChampionBet, AIVault, RevenueShare, VIPStaking) correctly calls `__Ownable_init(msg.sender)` in their `initialize()`.

**Fix:** Redeploy ScoreBet with `__Ownable_init(msg.sender)` in `initialize()`.

Contrast with ChampionBet.sol (correct):
```solidity
function initialize(address _pool) public initializer {
    __Ownable_init(msg.sender);  // ← THIS LINE IS MISSING IN ScoreBet
    pool = LuckyPool(_pool);
}
```

### 3.2 MEDIUM: No Reentrancy Guards on LuckyPool

**Severity: MEDIUM**

`LuckyPool.sol` lines 37-55: `deposit()` and `withdraw()` call external `usdt.transferFrom()` and `usdt.transfer()` without `nonReentrant` modifier. OpenZeppelin `ReentrancyGuardUpgradeable` is not imported.

Risk assessment:
- Checks-effects-interactions pattern IS followed (state updated before external call in withdraw, but deposit updates state AFTER external call)
- LuckyPool.deposit() updates `userDeposits`, `userBalance`, `totalDeposits`, `poolBalance` AFTER `usdt.transferFrom()` — vulnerable if USDT had callbacks
- With standard USDT (no callbacks), risk is low but defense-in-depth would recommend adding ReentrancyGuard

### 3.3 MEDIUM: LuckyPool Balance Not Deducted on Bet Placement

**Severity: MEDIUM**

When `ScoreBet.placeBet()` or `ChampionBet.placeBet()` is called:
- It checks `pool.userBalance(msg.sender) >= _amount` ✓
- But it does NOT deduct from `userBalance`
- User can withdraw their full balance from LuckyPool while having active bets
- No funds are escrowed/locked for active bets

This means the system has no guarantee that winning bettors can be paid from their locked balance.

### 3.4 LOW: AntiScoreBet Hardcoded Win

**Severity: LOW**

`AntiScoreBet.sol` line 68: `b.won = true; // Simplified: all anti-bets win in demo`

This is clearly marked as demo simplification but would need real score validation logic for production.

### 3.5 LOW: AIVault.getAPR() Dead Code

**Severity: LOW**

`AIVault.sol` lines 33-41 contain dead/suspicious code in `initTime()`:
```solidity
function initTime() private view returns (uint256) {
    return lastUpdate > 0 ? lastUpdate - (totalRevenue > 0 ? 0 : 0) : block.timestamp;
}
```
Both branches of the inner ternary return 0, making the subtraction a no-op.

### 3.6 VERIFIED SAFE

| Check | Status |
|---|---|
| Selfdestruct capability | NONE - no contract has selfdestruct |
| initialize() double-call | PROTECTED - OZ `initializer` modifier used |
| onlyOwner on admin functions | VERIFIED - all admin functions have `onlyOwner` |
| _authorizeUpgrade access | VERIFIED - uses `onlyOwner` on all UUPS contracts |
| unchecked external calls | None found (except intentional USDT transfers) |
| Overflow/underflow | PROTECTED - Solidity ^0.8.28 has built-in checks |
| Proxy storage collisions | PROTECTED - ERC1967 standard slots used |

---

## 4. GAS REPORT

### 4.1 Deployment Gas Costs (Sepolia)

| Contract | Gas Limit | Receipt Gas Used |
|---|---|---|
| MockUSDT | 637,525 | 489,892 |
| LuckyPool (impl) | 1,238,636 | 952,797 |
| LuckyPool (proxy) | 302,898 | 233,000 |
| AntiScoreBet (impl) | 1,442,166 | 1,109,359 |
| AntiScoreBet (proxy) | 274,416 | ~211,000 |
| ScoreBet (impl) | 910,208 | ~700,000 |
| ScoreBet (proxy) | 213,686 | ~164,000 |
| ChampionBet (impl) | 1,036,191 | ~797,000 |
| ChampionBet (proxy) | 245,151 | ~189,000 |
| AIVault (impl) | 850,951 | ~654,000 |
| AIVault (proxy) | 274,338 | ~211,000 |
| RevenueShare (impl) | 794,209 | ~611,000 |
| RevenueShare (proxy) | 360,032 | ~277,000 |
| VIPStaking (impl) | 1,009,896 | ~777,000 |
| VIPStaking (proxy) | 388,104 | ~299,000 |
| **TOTAL** | **~9,978,000** | **~7,675,000** |

### 4.2 Key Operation Gas Estimates

| Operation | Gas | Notes |
|---|---|---|
| LuckyPool.deposit | 152,231 | Includes ERC20 transferFrom |
| LuckyPool.withdraw | 178,605 | Includes ERC20 transfer |
| LuckyPool.toggleCircuitBreaker | 201,718 | testCircuitBreaker (includes deposit+breaker+revert) |
| AntiScoreBet.placeBet | 490,115 | Match creation + bet placement |
| ScoreBet.placeBet | 329,399 | Score hash betting |
| ScoreBet.settleBet | 353,268 | Owner-only settlement |
| ChampionBet.placeBet | 346,276 | Team betting |
| ChampionBet.settleBet | 444,064 | Full settlement path |
| AIVault.addRevenue | 82,435 | Cross-contract call to pool |
| RevenueShare.collectFee | 41,093 | Simple state update |
| RevenueShare.setShares | 43,192 | Four uint storage writes |
| VIPStaking.stake | 117,111 | VIP level calculation |
| VIPStaking.unstake | 124,833 | VIP downgrade path |

---

## 5. SUMMARY & RECOMMENDATIONS

### Immediate Action Required
1. **Redeploy ScoreBet** with `__Ownable_init(msg.sender)` in `initialize()` — current deployment is permanently broken

### Recommended Improvements
2. Add `ReentrancyGuardUpgradeable` to LuckyPool for defense-in-depth
3. Deduct `userBalance` when bets are placed (or implement bet escrow)
4. Remove dead code from AIVault.initTime()
5. Replace AntiScoreBet hardcoded win logic with real score validation
6. Add event emissions for key state changes (RevenueShare.setShares, LuckyPool.setDailyDrawdownLimit)
7. Consider adding timelock for admin functions (setDailyDrawdownLimit, toggleCircuitBreaker)
