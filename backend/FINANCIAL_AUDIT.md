# Financial Audit Report — 19888 Backend

**File audited:** `/Users/jack/Desktop/19888-platform/backend/server.js` (3104 lines)  
**Date:** 2026-06-24  
**Findings:** 16 financial logic gaps, race conditions, and security bypasses.

---

## CRITICAL (Immediate Fix)

### [C1] Deposit Bypass — No tx_hash Required (Line 2315-2321)
```js
if (!tx_hash || typeof tx_hash !== 'string' || tx_hash.trim().length === 0) {
  console.log('[Deposit] Direct deposit:', addr, amt);
  const user = getOrCreateUser(addr);
  user.balance = Math.max(0, +(user.balance || 0) + amt);
  write('users', ...);
  return res.json({ code: 0, msg: '充值成功', ... });
}
```
**Verdict: MASSIVE BYPASS** — Any unauthenticated caller can credit any wallet address any amount simply by omitting `tx_hash`. The empty-tx_hash branch performs ZERO verification. This is an unauthenticated infinite-money vulnerability.

### [C2] Score-Bet Place: Balance Double-Deducted Outside Lock (Line 1533-1536)
```js
// Line 1498-1508: lockedUpdate('users') deducts balance, adds frozen_bet
const result = await lockedUpdate('users', ...);  // ded + frozen

// Lines 1516-1531: reads bets, pushes, writes — no lock on bets
const bets = read('bets');
...
write('bets', bets);

// Lines 1533-1536: SECOND deduction outside any lock!
user.balance = Math.max(0, +(user.balance - amt).toFixed(4));
user.frozen_bet = (user.frozen_bet || 0) + amt;
write('users', users);
```
**Verdict:** The user variable at L1534 references `result` from the lockedUpdate (L1498), but `write('users', users)` at L1536 writes the global data re-read inside lockedUpdate's scope. Between L1508 and L1536, another request can modify users. The balance is **deducted twice** — once inside lockedUpdate and once outside. This is a **double-deduction bug**.

### [C3] Admin Settle Match — No Lock on Users/Bets (Lines 1905-1944)
```js
const bets = read('bets');
const users = read('users');
let settledCount = 0, totalPayout = 0;
for (const bet of bets) {
  if (bet.match_id !== mid || bet.status !== 'pending') continue;
  bet.status = won ? 'won' : 'lost';
  if (won && user) {
    user.balance = (user.balance || 0) + bet.potential_win;
  }
  user.frozen_bet = Math.max(0, ...);
  settledCount++;
}
write('bets', bets);
write('users', users);
```
**Verdict:** Entire settlement operation runs outside `lockedUpdate`. If two admin settle calls race (same match or overlapping users), balances and frozen_bet values will be corrupted. A concurrent withdrawal during settlement can cause negative balances or double-payout.

### [C4] Chain Event Listener Credits Wrong Field + No Dedup (Lines 3080-3083)
```js
var user = users.find(function(u) {
  return u.wallet_address.toLowerCase() === ev.args.from.toLowerCase();  // BUG: field is 'address', not 'wallet_address'
});
if (user) user.balance = (Number(user.balance||0) + amount).toFixed(2);  // .toFixed(2) truncates! No dedup!
write('users', users);
```
**Verdict:** Two bugs:
1. **Wrong field**: Users are stored with field `address` (line 328), but the listener searches for `wallet_address`. **Every deposit via Transfer event is silently lost** — no user is ever found.
2. **No dedup**: Same event can be picked up across restarts (lastBlock resets to 0 on each restart, L3062), causing double-credit.
3. **Floating-point truncation** via `.toFixed(2)` rounds balances to cents, losing precision.

---

## HIGH

### [H1] Bet Confirm — No Lock on Balance Update (Lines 1359-1390)
```js
const users = read('users');
const user = users.find(u => u.address.toLowerCase() === addr);
...
user.balance = Math.max(0, +(user.balance - amt).toFixed(4));
user.frozen_bet = (user.frozen_bet || 0) + amt;
write('users', users);
```
**Verdict:** Despite having on-chain tx verification, the balance deduction uses raw read-modify-write with no lock. A concurrent bet/cancel/withdraw can cause the balance check at L1365 to pass, but the actual balance write at L1388-1390 uses a stale value — **race-condition overdraft**.

### [H2] Champion/Anti-Bet Place: Non-Atomic Across Two Files (Lines 1273-1314 / 1428-1460)
```js
// Step 1: lockedUpdate('users') — deduct balance ✓
// Step 2: read('bets'), push, write('bets') — NO LOCK ON BETS
```
**Verdict:** If the server crashes between steps 1 and 2, the user's balance is deducted but the bet is never recorded. The money is gone with no trace.

### [H3] Admin Manual Deposit — No Lock (Lines 2666-2670)
```js
const users = read('users');
const u = users.find(x => x.address.toLowerCase() === addr);
if (u) { u.balance = (u.balance||0) + amt; ... }
else { users.push({ address: addr, balance: amt, ... }); }
write('users', users);
```
**Verdict:** Raw read-modify-write with no lock. A concurrent withdrawal or bet could see the balance before the manual deposit is written.

### [H4] Invite Claim Reward — No Lock (Lines 2089-2122)
```js
const users = read('users');
const user = users.find(u => u.address.toLowerCase() === addr);
// ... compute rewards ...
user.balance = (user.balance || 0) + unclaimedRewards;
write('users', users);
```
**Verdict:** Read-modify-write without lock. Concurrent claim + withdrawal = double-spend of rewards.

### [H5] AI Hosting Activate/Deactivate — No Lock (Lines 812-854 / 876-920)
```js
const users = read('users');
const user = users.find(...);
user.frozen_ai = (user.frozen_ai || 0) + freezeAmt;  // or -=
write('users', users);
```
**Verdict:** Both operations read/write users without lock. Simultaneous activate+deactivate or activate+withdraw can corrupt `frozen_ai` and `balance`.

---

## MEDIUM

### [M1] `champion_odds` vs `championship_odds` Field Mismatch (Lines 509/1298 vs 1717)
- **Data/seeds use:** `champion_odds` (field name)
- **Bet placement reads:** `team.champion_odds` (L1298) ✓
- **Admin API writes:** `t.championship_odds` (L1717) ✗

**Verdict:** When an admin updates odds via `PUT /api/admin/teams/:id` with field `championship_odds`, a *new* field is created on the team object. Bet placement continues reading the *old* `champion_odds` field. **Admin odds updates silently have no effect.**

### [M2] Inconsistent Available Balance Calculations (Lines 827, 2167)
- `computeBalance()` (L369) correctly subtracts `frozen_bet + frozen_ai + frozen_withdraw` from `balance`.
- AI hosting activate (L827): `available = balance - frozen_bet - frozen_ai` — **missing frozen_withdraw**.
- Withdraw endpoint (L2167): `available = balance - frozen_bet - frozen_ai` — **missing frozen_withdraw**.

**Verdict:** A user with frozen_withdraw > 0 can activate AI hosting or withdraw additional funds against already-frozen amounts, overcommitting the same balance.

### [M3] Pool Balance Tracking Missing `frozen_withdraw` (Lines 1804, 2794)
- Admin stats (L1804): `sum(balance + frozen_bet + frozen_ai)` — **missing frozen_withdraw**
- Pool status (L2794): `sum(frozen_bet + frozen_ai)` — **missing frozen_withdraw**

**Verdict:** The total pool balance appears smaller than actual user claims. The system under-reports liabilities by the sum of all frozen_withdraw amounts.

### [M4] DailyUpdate Auto-Settle — No Verification (Lines 547-600)
```js
const homeScore = Math.floor(Math.random() * 5);
const awayScore = Math.floor(Math.random() * 5);
```
**Verdict:** Match results are determined by `Math.random()`, not real-world outcomes or on-chain events. Scores are generated server-side with no oracle, no admin approval, and no on-chain verification. This is a **mock settlement engine** — real matches would require a trusted result source.

### [M5] `lockedUpdate` Uses `setImmediate` — Race Window (Line 237)
```js
function lockedUpdate(name, updateFn) {
  return new Promise((resolve, reject) => {
    setImmediate(async () => {  // <-- deferred execution
      await acquireLock(name, 3000);
```
**Verdict:** The `setImmediate` defers execution by one tick. Between `lockedUpdate()` being called and the lock actually being acquired, the caller's context continues executing. If the caller does non-atomic work before awaiting (like champion bet at L1284 which reads bets *after* lockedUpdate resolves), those reads are against unlocked state.

### [M6] Deposit with tx_hash — On-Chain Verify Then No Lock (Lines 2356-2378)
```js
const user = getOrCreateUser(addr);
const users = read('users');           // fresh read
const u = users.find(x => ...);
if (u) {
  u.balance = (u.balance || 0) + amt; // modify
  write('users', users);               // write — NO LOCK
}
```
**Verdict:** Even the verified deposit path lacks `lockedUpdate`. Two simultaneous verified deposits to the same address (or concurrent with another operation) can lose one.

---

## LOW

### [L1] Duplicate Bet Check Missing for Anti-Score & Score Bets
- Champion bet (L1288-1293): checks for existing pending bet with same user+team+type ✓
- Anti-bet & score-bet: **no duplicate check** — user can place unlimited identical bets.

### [L2] isDuplicateTx Reads Full File Every Call (Line 271-274)
```js
function isDuplicateTx(txHash, collection) {
  if (!txHash) return false;
  const records = read(collection);
  return records.some(r => r.tx_hash && ...);
}
```
**Verdict:** Inefficient but not a race bug per se. Called during withdrawal (L2157) only — but reads the entire withdrawals file for each check.

### [L3] Bet Records — No Lock Between Filtering and Count
The bet-records endpoint (L991-1064) reads `read('bets')` once for filtering. This is a read-only operation and safe from write corruption, but the stats computed (total_wagered, total_won) may be slightly stale — acceptable for a query endpoint.

---

## SUMMARY TABLE

| # | Severity | Issue | Lines |
|---|----------|-------|-------|
| C1 | CRITICAL | Deposit bypass — no tx_hash required | 2315-2321 |
| C2 | CRITICAL | Score-bet double deduction outside lock | 1533-1536 |
| C3 | CRITICAL | Admin settle-match: no lock on users/bets | 1905-1944 |
| C4 | CRITICAL | Chain listener: wrong field + no dedup | 3080-3083 |
| H1 | HIGH | Bet confirm: balance update without lock | 1359-1390 |
| H2 | HIGH | Bet place: non-atomic across two files | 1273-1314 |
| H3 | HIGH | Admin manual deposit: no lock | 2666-2670 |
| H4 | HIGH | Invite reward claim: no lock | 2089-2122 |
| H5 | HIGH | AI hosting activate/deactivate: no lock | 812-920 |
| M1 | MEDIUM | champion_odds vs championship_odds mismatch | 509/1298 vs 1717 |
| M2 | MEDIUM | Available balance calc missing frozen_withdraw | 827, 2167 |
| M3 | MEDIUM | Pool balance tracking missing frozen_withdraw | 1804, 2794 |
| M4 | MEDIUM | DailyUpdate uses Math.random() — no oracle | 547-600 |
| M5 | MEDIUM | lockedUpdate setImmediate creates race window | 237 |
| M6 | MEDIUM | Deposit (verified path) without lock | 2356-2378 |
| L1 | LOW | No duplicate bet check for anti/score bets | 1399-1539 |
| L2 | LOW | isDuplicateTx reads full file per call | 271-274 |
| L3 | LOW | Bet records: stale stats (acceptable) | 991-1064 |

---

## RECOMMENDATIONS

1. **Remove the tx_hash bypass** from deposit (C1) or add admin-only auth.
2. **Fix score-bet double-deduction** (C2) — remove lines 1533-1536 (already handled inside lockedUpdate).
3. **Wrap all admin settlement** (C3), deposit paths, AI hosting, invite rewards, and bet-confirm in `lockedUpdate('users', ...)`.
4. **Fix chain listener** (C4): change `wallet_address` → `address`, add dedup by tx_hash, and use `parseFloat` not `.toFixed(2)`.
5. **Standardize the odds field**: rename `championship_odds` in admin API to `champion_odds` (M1).
6. **Always use `computeBalance()`** for available balance checks (M2).
7. **Include `frozen_withdraw`** in pool balance calculations (M3).
8. **Replace Math.random() settlement** with a trusted admin+oracle flow (M4).
9. **Add duplicate bet checks** to anti-bet and score-bet endpoints (L1).
10. **Consider an in-memory database or SQLite** for proper ACID transactions instead of JSON-file-based storage.
