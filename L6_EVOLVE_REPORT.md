# 🧬 L6 Self-Evolving Test Report

**Generated**: 2026-06-07 12:06:59  
**Duration**: 0.5s  
**Project**: 19888 Platform  

---

## 🎯 Evolution Score: 67.8/100

| Metric | Score | Weight |
|--------|-------|--------|
| Baseline Pass Rate | 96% | 30% |
| Mutation Score | 50% | 35% |
| Coverage | 62% | 35% |

---

## 📊 Baseline Test Results

**22/23 tests passed** (95%)

| Test | Result | Detail |
|------|--------|--------|
| js_syntax | ✅ | OK |
| css_balance | ✅ | {=1044 }=1044 |
| dom_consistency | ❌ | missing=['grid-payout-amount', 'grid-payout-preview', 'grid-bet-amount'] |
| backend_status | ✅ | HTTP 200 |
| api__api_status | ✅ | HTTP 200 |
| api__api_matches | ✅ | HTTP 200 |
| api__api_champion-bet_odds | ✅ | HTTP 200 |
| admin_auth | ✅ | OK |
| html_wellformed_index.html | ✅ | open=1263 close=1265 |
| html_wellformed_admin.html | ✅ | open=223 close=223 |
| html_wellformed_rules.html | ✅ | open=277 close=277 |
| data_integrity_bets.json | ✅ | valid JSON |
| data_integrity_champion_teams.json | ✅ | valid JSON |
| data_integrity_admins.json | ✅ | valid JSON |
| data_integrity_users.json | ✅ | valid JSON |
| data_integrity_matches.json | ✅ | valid JSON |
| api_validation__api_status | ✅ | valid |
| api_validation__api_matches | ✅ | valid |
| api_validation__api_champion-bet_odds | ✅ | valid |
| css_render_has_theme_vars | ✅ | found |
| css_render_has_responsive | ✅ | found |
| css_render_has_animations | ✅ | found |
| css_render_has_touch_targets | ✅ | found |

---

## 🧬 Mutation Testing

**Mutation Score**: 6/12 (50%)

### ⚠️ Mutation Survivors (Test Gaps)

These mutations were NOT caught by any test — indicating test gaps:

| File | Line | Mutation | Tests Run |
|------|------|----------|-----------|
| style.css | 18 | change_numeric(1→2) | 1 |
| style.css | 18 | change_numeric(2→1) | 1 |
| server.js | 214 | remove_line(L214) | 1 |
| server.js | 51 | flip_boolean(true→false) | 1 |
| server.js | 52 | flip_boolean(true→false) | 1 |
| server.js | 62 | change_numeric(15→14) | 1 |

### All Mutation Results

| File | Line | Mutation | Caught? |
|------|------|----------|---------|
| app.js | 44 | change_op(!==→===) | ✅ |
| app.js | 44 | change_op(===→!==) | ✅ |
| app.js | 28 | change_numeric(18→17) | ✅ |
| app.js | 44 | change_op(!==→===) | ✅ |
| style.css | 18 | change_numeric(1→2) | ❌ |
| style.css | 18 | change_numeric(2→1) | ❌ |
| style.css | 2159 | remove_line(L2159) | ✅ |
| style.css | 18 | change_numeric(1→0) | ✅ |
| server.js | 214 | remove_line(L214) | ❌ |
| server.js | 51 | flip_boolean(true→false) | ❌ |
| server.js | 52 | flip_boolean(true→false) | ❌ |
| server.js | 62 | change_numeric(15→14) | ❌ |

---

## 📐 Coverage Map

**8/10 components tested** (61.8% LOC)

| Component | Status | Files | LOC |
|-----------|--------|-------|-----|
| js_syntax | ✅ Tested | 1 | 2660 |
| js_contracts | ❌ Untested | 1 | 2660 |
| css_balance | ✅ Tested | 1 | 2851 |
| css_inline | ✅ Tested | 3 | 2545 |
| html_wellformed | ✅ Tested | 3 | 2545 |
| dom_consistency | ❌ Untested | 4 | 5205 |
| backend_status | ✅ Tested | 1 | 588 |
| api_endpoints | ✅ Tested | 1 | 588 |
| admin_auth | ✅ Tested | 2 | 594 |
| data_integrity | ✅ Tested | 5 | 338 |

---

## 📅 Adaptive Schedule

**20 tests scheduled** across 5 priority levels

| Priority | Count | Description |
|----------|-------|-------------|
| 🔴 Mutation survivors | 2 |
| 🟠 Failure hotspots | 6 |
| 🟡 Untested components | 1 |
| 🔵 Git-diff predictions | 2 |
| ⚪ Round-robin | 9 |

### Top 10 Scheduled Tests

| Pri | Component | Reason | Weight |
|-----|-----------|--------|--------|
| P1 | css_balance | Mutation survivor: change_numeric(1→2) | 1.0 |
| P1 | backend_status | Mutation survivor: remove_line(L214) | 1.0 |
| P2 | dom_consistency | Failure hotspot (weight=1.0) | 1.0 |
| P2 | html_wellformed_index.html | Failure hotspot (weight=0.438) | 0.438 |
| P2 | html_wellformed_admin.html | Failure hotspot (weight=0.438) | 0.438 |
| P2 | api_validation__api_status | Failure hotspot (weight=0.25) | 0.25 |
| P2 | api_validation__api_matches | Failure hotspot (weight=0.25) | 0.25 |
| P2 | api_validation__api_champion-bet_odds | Failure hotspot (weight=0.25) | 0.25 |
| P3 | js_contracts | Untested component | 0.7 |
| P4 | js_syntax | Recently changed (git diff) | 0.6 |

---

## 🔮 Predictive Testing (Git Diff)

**Changed files**: 13  
**Predicted tests**: 17  

| File | Predicted Tests | Confidence |
|------|-----------------|------------|
| admin.html | dom_consistency, html_wellformed | high |
| AIVault.sol | contract_compile | high |
| AntiScoreBet.sol | contract_compile | high |
| ChampionBet.sol | contract_compile | high |
| Counter.sol | contract_compile | high |
| LuckyPool.sol | contract_compile | high |
| RevenueShare.sol | contract_compile | high |
| ScoreBet.sol | contract_compile | high |
| VIPStaking.sol | contract_compile | high |
| style.css | css_balance | high |
| index.html | dom_consistency, html_wellformed | high |
| app.js | js_syntax, dom_consistency | high |
| rules.html | dom_consistency, html_wellformed | high |

---

## 🧠 Failure Memory

**Total runs**: 284  
**Unique tests**: 23  
**Hotspots**: 3  

| Test | Weight | Total | Passed | Failed | Streak |
|------|--------|-------|--------|--------|--------|
| dom_consistency | 1.000 | 16 | 3 | 13 | 7 |
| html_wellformed_index.html | 0.438 | 16 | 9 | 7 | 0 |
| html_wellformed_admin.html | 0.438 | 16 | 9 | 7 | 0 |
| api_validation__api_status | 0.250 | 4 | 3 | 1 | 0 |
| api_validation__api_matches | 0.250 | 4 | 3 | 1 | 0 |
| api_validation__api_champion-bet_odds | 0.250 | 4 | 3 | 1 | 0 |
| admin_auth | 0.188 | 16 | 13 | 3 | 0 |
| backend_status | 0.062 | 16 | 15 | 1 | 0 |
| api__api_status | 0.062 | 16 | 15 | 1 | 0 |
| api__api_matches | 0.062 | 16 | 15 | 1 | 0 |

---

## 💡 Evolution Insights

- 🟡 **Moderate mutation score** (50%): Consider adding more targeted tests for survivors.
- 🟡 **Moderate coverage** (61.8%): Focus on: ['js_contracts', 'dom_consistency']
- 🟠 **Failure hotspots**: [('dom_consistency', 1.0), ('html_wellformed_index.html', 0.438), ('html_wellformed_admin.html', 0.438)] — schedule these more frequently.
- 🔴 **6 mutation survivors** indicate untested code paths. Priority: add tests that exercise these mutations.

---

*Report generated by L6 Self-Evolving Test Strategy*  
*History: `/tmp/l6_test_history.json`*  
