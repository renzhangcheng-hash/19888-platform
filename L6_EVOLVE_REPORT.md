# 🧬 L6 Self-Evolving Test Report

**Generated**: 2026-06-10 11:39:32  
**Duration**: 0.8s  
**Project**: 19888 Platform  

---

## 🎯 Evolution Score: 59.8/100

| Metric | Score | Weight |
|--------|-------|--------|
| Baseline Pass Rate | 92% | 30% |
| Mutation Score | 33% | 35% |
| Coverage | 59% | 35% |

---

## 📊 Baseline Test Results

**23/25 tests passed** (92%)

| Test | Result | Detail |
|------|--------|--------|
| js_syntax | ✅ | OK |
| css_balance | ✅ | {=1043 }=1043 |
| dom_consistency | ❌ | missing=['ai-deposit-amount', 'ai-predict-deposit-amount', 'detail-venue-name',  |
| backend_status | ✅ | HTTP 200 |
| api__api_status | ✅ | HTTP 200 |
| api__api_matches | ✅ | HTTP 200 |
| api__api_champion-bet_odds | ✅ | HTTP 200 |
| admin_auth | ❌ | {"code":2,"msg":"管理接口请求过于频繁，请15分钟后再试"} |
| html_wellformed_index.html | ✅ | open=254 close=254 |
| html_wellformed_admin.html | ✅ | open=223 close=223 |
| html_wellformed_rules.html | ✅ | open=277 close=277 |
| data_integrity_bets.json | ✅ | valid JSON |
| data_integrity_ai_pool.json | ✅ | valid JSON |
| data_integrity_champion_teams.json | ✅ | valid JSON |
| data_integrity_admins.json | ✅ | valid JSON |
| data_integrity_users.json | ✅ | valid JSON |
| data_integrity_ai_logs.json | ✅ | valid JSON |
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

**Mutation Score**: 4/12 (33%)

### ⚠️ Mutation Survivors (Test Gaps)

These mutations were NOT caught by any test — indicating test gaps:

| File | Line | Mutation | Tests Run |
|------|------|----------|-----------|
| style.css | 2210 | remove_line(L2210) | 1 |
| style.css | 10 | change_numeric(1→0) | 1 |
| style.css | 23 | change_numeric(20→21) | 1 |
| style.css | 23 | change_numeric(21→22) | 1 |
| server.js | 122 | remove_line(L122) | 1 |
| server.js | 29 | change_op(||→&&) | 1 |
| server.js | 106 | remove_line(L106) | 1 |
| server.js | 71 | change_numeric(15→14) | 1 |

### All Mutation Results

| File | Line | Mutation | Caught? |
|------|------|----------|---------|
| app.js | 43 | change_numeric(6→7) | ✅ |
| app.js | 8 | change_op(&&→||) | ✅ |
| app.js | 43 | change_numeric(7→6) | ✅ |
| app.js | 9 | flip_boolean(true→false) | ✅ |
| style.css | 2210 | remove_line(L2210) | ❌ |
| style.css | 10 | change_numeric(1→0) | ❌ |
| style.css | 23 | change_numeric(20→21) | ❌ |
| style.css | 23 | change_numeric(21→22) | ❌ |
| server.js | 122 | remove_line(L122) | ❌ |
| server.js | 29 | change_op(||→&&) | ❌ |
| server.js | 106 | remove_line(L106) | ❌ |
| server.js | 71 | change_numeric(15→14) | ❌ |

---

## 📐 Coverage Map

**7/10 components tested** (58.6% LOC)

| Component | Status | Files | LOC |
|-----------|--------|-------|-----|
| js_syntax | ✅ Tested | 1 | 2694 |
| js_contracts | ❌ Untested | 1 | 2694 |
| css_balance | ✅ Tested | 1 | 2687 |
| css_inline | ✅ Tested | 3 | 1593 |
| html_wellformed | ✅ Tested | 3 | 1593 |
| dom_consistency | ❌ Untested | 4 | 4287 |
| backend_status | ✅ Tested | 1 | 1410 |
| api_endpoints | ✅ Tested | 1 | 1410 |
| admin_auth | ❌ Untested | 2 | 1416 |
| data_integrity | ✅ Tested | 7 | 500 |

---

## 📅 Adaptive Schedule

**20 tests scheduled** across 5 priority levels

| Priority | Count | Description |
|----------|-------|-------------|
| 🔴 Mutation survivors | 2 |
| 🟠 Failure hotspots | 2 |
| 🟡 Untested components | 1 |
| 🔵 Git-diff predictions | 2 |
| ⚪ Round-robin | 13 |

### Top 10 Scheduled Tests

| Pri | Component | Reason | Weight |
|-----|-----------|--------|--------|
| P1 | css_balance | Mutation survivor: remove_line(L2210) | 1.0 |
| P1 | backend_status | Mutation survivor: remove_line(L122) | 1.0 |
| P2 | dom_consistency | Failure hotspot (weight=1.0) | 1.0 |
| P2 | admin_auth | Failure hotspot (weight=0.6) | 0.6 |
| P3 | js_contracts | Untested component | 0.7 |
| P4 | js_syntax | Recently changed (git diff) | 0.6 |
| P4 | css_inline | Recently changed (git diff) | 0.6 |
| P5 | api__api_status | Round-robin (weight=0.0) | 0.0 |
| P5 | api__api_matches | Round-robin (weight=0.0) | 0.0 |
| P5 | api__api_champion-bet_odds | Round-robin (weight=0.0) | 0.0 |

---

## 🔮 Predictive Testing (Git Diff)

**Changed files**: 18  
**Predicted tests**: 25  

| File | Predicted Tests | Confidence |
|------|-----------------|------------|
| admin.html | dom_consistency, html_wellformed | high |
| package-lock.json | data_integrity | high |
| package.json | data_integrity | high |
| server.js | js_syntax, dom_consistency, backend_status, api_endpoints, admin_auth | high |
| deploy-sepolia.json | data_integrity | high |
| AIVault.sol | contract_compile | high |
| AntiScoreBet.sol | contract_compile | high |
| LuckyPool.sol | contract_compile | high |
| ScoreBet.sol | contract_compile | high |
| VIPStaking.sol | contract_compile | high |
| style.css | css_balance | high |
| index.html | dom_consistency, html_wellformed | high |
| app.js | js_syntax, dom_consistency | high |
| manifest.json | data_integrity | high |
| rules.html | dom_consistency, html_wellformed | high |

---

## 🧠 Failure Memory

**Total runs**: 50  
**Unique tests**: 25  
**Hotspots**: 2  

| Test | Weight | Total | Passed | Failed | Streak |
|------|--------|-------|--------|--------|--------|
| dom_consistency | 1.000 | 2 | 0 | 2 | 2 |
| admin_auth | 0.600 | 2 | 1 | 1 | 1 |
| js_syntax | 0.000 | 2 | 2 | 0 | 0 |
| css_balance | 0.000 | 2 | 2 | 0 | 0 |
| backend_status | 0.000 | 2 | 2 | 0 | 0 |
| api__api_status | 0.000 | 2 | 2 | 0 | 0 |
| api__api_matches | 0.000 | 2 | 2 | 0 | 0 |
| api__api_champion-bet_odds | 0.000 | 2 | 2 | 0 | 0 |
| html_wellformed_index.html | 0.000 | 2 | 2 | 0 | 0 |
| html_wellformed_admin.html | 0.000 | 2 | 2 | 0 | 0 |

---

## 💡 Evolution Insights

- 🔴 **Low mutation score** (33%): Many mutations survive. Strengthen tests for server.js, style.css.
- 🟡 **Moderate coverage** (58.6%): Focus on: ['js_contracts', 'dom_consistency', 'admin_auth']
- 🟠 **Failure hotspots**: [('dom_consistency', 1.0), ('admin_auth', 0.6)] — schedule these more frequently.
- 🔴 **8 mutation survivors** indicate untested code paths. Priority: add tests that exercise these mutations.

---

*Report generated by L6 Self-Evolving Test Strategy*  
*History: `/tmp/l6_test_history.json`*  
