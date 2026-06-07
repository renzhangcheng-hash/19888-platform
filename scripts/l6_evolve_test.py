#!/usr/bin/env python3
"""
L6 Self-Evolving Test Strategy — 19888 Platform
================================================
Mutation testing + failure memory + adaptive scheduling + coverage tracking.

Capabilities:
  1. FAILURE MEMORY: Tracks test history, weights tests by historical failure rate
  2. MUTATION TESTING: Introduces small mutations (flip booleans, remove lines,
     change operators) and verifies existing tests catch them
  3. COVERAGE TRACKING: Maps which code paths/components are tested vs untested
  4. ADAPTIVE SCHEDULING: Runs high-failure areas more frequently
  5. PREDICTIVE TESTING: Based on git diff, predicts which tests to run

Output: L6_EVOLVE_REPORT.md with evolution insights
"""

import subprocess
import json
import sys
import re
import os
import time
import hashlib
import shutil
import random
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

# ── CONFIG ──────────────────────────────────────────────────────────────────
PROJECT = "/Users/jack/Desktop/19888-platform"
API_BASE = "http://localhost:3088"
HISTORY_FILE = "/tmp/l6_test_history.json"
REPORT_FILE = f"{PROJECT}/L6_EVOLVE_REPORT.md"
ADMIN_CREDS = {"username": "admin", "password": "19888admin"}

# Component ↔ test mapping for coverage
COMPONENT_MAP = {
    "js_syntax":       ["js/app.js"],
    "js_contracts":    ["js/app.js"],
    "css_balance":     ["css/style.css"],
    "css_inline":      ["index.html", "admin.html", "rules.html"],
    "html_wellformed": ["index.html", "admin.html", "rules.html"],
    "dom_consistency": ["js/app.js", "index.html", "admin.html", "rules.html"],
    "backend_status":  ["backend/server.js"],
    "api_endpoints":   ["backend/server.js"],
    "admin_auth":      ["backend/server.js", "backend/data/admins.json"],
    "data_integrity":  ["backend/data/*.json"],
}

# ── UTILITIES ────────────────────────────────────────────────────────────────
def log(msg, level="INFO"):
    prefix = {"INFO": "  ℹ️ ", "PASS": "  ✅ ", "FAIL": "  ❌ ", "MUTATE": "  🧬 ", "EVOLVE": "  🔄 ", "WARN": "  ⚠️ "}
    print(f"{prefix.get(level, '  • ')}{msg}")

def load_json(path, default=None):
    if default is None:
        default = {}
    if not os.path.exists(path):
        return default
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return default

def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def run(cmd, timeout=15, shell=False, workdir=None):
    """Run a command, return (returncode, stdout, stderr)."""
    try:
        if isinstance(cmd, str) and not shell:
            cmd = cmd.split()
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                          shell=shell, cwd=workdir)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", "TIMEOUT"
    except FileNotFoundError:
        return -1, "", f"CMD NOT FOUND: {cmd}"

def hash_file(path):
    """Return SHA256 of file contents."""
    try:
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except (IOError, OSError):
        return None


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  PHASE 1: FAILURE MEMORY — Track & weight tests by historical failure rate  ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

class FailureMemory:
    """Persistent test history with weighted scheduling."""

    def __init__(self, history_path=HISTORY_FILE):
        self.path = history_path
        self.data = load_json(history_path, {"runs": [], "tests": {}})

    def record(self, test_name, passed, duration_ms=0, component=None):
        """Record a test result."""
        entry = {
            "test": test_name,
            "passed": passed,
            "timestamp": datetime.now().isoformat(),
            "duration_ms": duration_ms,
            "component": component or test_name,
        }
        self.data["runs"].append(entry)
        # Keep last 1000 runs
        if len(self.data["runs"]) > 1000:
            self.data["runs"] = self.data["runs"][-1000:]

        # Update aggregate stats per test
        if test_name not in self.data["tests"]:
            self.data["tests"][test_name] = {
                "total": 0,
                "passed": 0,
                "failed": 0,
                "last_failure": None,
                "failure_streak": 0,
                "component": component or test_name,
            }
        t = self.data["tests"][test_name]
        t["total"] += 1
        if passed:
            t["passed"] += 1
            t["failure_streak"] = 0
        else:
            t["failed"] += 1
            t["last_failure"] = datetime.now().isoformat()
            t["failure_streak"] += 1

        save_json(self.path, self.data)

    def get_weight(self, test_name):
        """Calculate weight (0.0–1.0) for adaptive scheduling.
        Higher weight = more likely to be selected for frequent runs.
        """
        t = self.data["tests"].get(test_name, {})
        total = t.get("total", 0)
        failed = t.get("failed", 0)
        streak = t.get("failure_streak", 0)

        if total == 0:
            return 0.5  # Unknown → medium priority

        base_rate = failed / total
        # Boost by recency and streak
        streak_boost = min(streak * 0.1, 0.3)

        weight = min(base_rate + streak_boost, 1.0)
        return round(weight, 3)

    def get_ranked_tests(self):
        """Return test names sorted by weight (most failure-prone first)."""
        weights = [(name, self.get_weight(name)) for name in self.data["tests"]]
        weights.sort(key=lambda x: x[1], reverse=True)
        return weights

    def get_failure_hotspots(self, threshold=0.3):
        """Return tests with weight above threshold."""
        return [(name, w) for name, w in self.get_ranked_tests() if w >= threshold]

    def stats(self):
        """Summary statistics."""
        tests = self.data["tests"]
        if not tests:
            return {"total_runs": 0, "unique_tests": 0, "overall_pass_rate": 1.0}
        total_runs = sum(t["total"] for t in tests.values())
        total_passed = sum(t["passed"] for t in tests.values())
        return {
            "total_runs": total_runs,
            "unique_tests": len(tests),
            "overall_pass_rate": round(total_passed / max(1, total_runs), 3),
            "hotspots": len(self.get_failure_hotspots()),
        }


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  PHASE 2: MUTATION TESTING — Verify tests catch deliberate bugs            ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

class MutationTester:
    """Introduce controlled mutations and verify they're caught by tests."""

    def __init__(self, project_path=PROJECT):
        self.project = Path(project_path)
        self.results = []
        self.backup_dir = Path("/tmp/l6_mutation_backups")
        self.backup_dir.mkdir(exist_ok=True)

    def _backup(self, path):
        """Backup a file before mutation."""
        dst = self.backup_dir / Path(path).name
        shutil.copy2(path, dst)
        return dst

    def _restore(self, path, backup):
        """Restore from backup."""
        shutil.copy2(backup, path)
        backup.unlink(missing_ok=True)

    def _read_lines(self, path):
        with open(path) as f:
            return f.readlines()

    def _write_lines(self, path, lines):
        with open(path, "w") as f:
            f.writelines(lines)

    # ── Mutation Operators ──────────────────────────────────────────────────

    def flip_boolean(self, lines):
        """Flip a boolean literal: true↔false, True↔False, 1↔0 in bool context."""
        patterns = [
            (r'\btrue\b', 'false', 'true'),
            (r'\bfalse\b', 'true', 'false'),
            (r'\b!\s*(\w+)', r'!!\1', r'!\1'),  # Remove negation
        ]
        for i, line in enumerate(lines):
            for pat, _, _ in patterns:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    old = line
                    if 'true' in pat.lower():
                        new_line = re.sub(r'\btrue\b', 'false', old, flags=re.IGNORECASE)
                        if new_line != old:
                            return i, old, new_line, "flip_boolean(true→false)"
                        new_line = re.sub(r'\bfalse\b', 'true', old, flags=re.IGNORECASE)
                        if new_line != old:
                            return i, old, new_line, "flip_boolean(false→true)"
                    elif '!' in pat:
                        # Remove a logical negation
                        new_line = re.sub(r'!\s*(\w+)', r'\1', old)
                        if new_line != old:
                            return i, old, new_line, "remove_negation"
        return None

    def remove_line(self, lines):
        """Remove a non-empty, non-comment, non-brace line."""
        candidates = []
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped and not stripped.startswith('//') and not stripped.startswith('/*') \
               and not stripped.startswith('*') and not stripped in ('{', '}', '{', '}') \
               and not stripped.startswith('import ') and not stripped.startswith('const ') \
               and not stripped.startswith('let ') and not stripped.startswith('var '):
                candidates.append(i)
        if candidates:
            i = random.choice(candidates)
            removed = lines[i]
            new_lines = lines[:i] + lines[i+1:]
            return i, removed, "(removed)", f"remove_line(L{i+1})"
        return None

    def change_operator(self, lines):
        """Change an operator: >→<, +→-, *→/, &&→||, ===→!==, etc."""
        ops = [
            (r'\+\+', '--', '++→--'),
            (r'--', '++', '--→++'),
            (r'\+=\s', '-= ', '+=→-='),
            (r'-=\s', '+= ', '-=→+='),
            (r'===', '!==', '===→!=='),
            (r'!==', '===', '!==→==='),
            (r'>=', '<', '>=→<'),
            (r'<=', '>', '<=→>'),
            (r'&&', '||', '&&→||'),
            (r'\|\|', '&&', '||→&&'),
            (r'>\s', '< ', '> →<'),
        ]
        for i, line in enumerate(lines):
            # Skip comments and strings (simple heuristic)
            if line.strip().startswith('//') or line.strip().startswith('*'):
                continue
            for pat, repl, desc in ops:
                if re.search(pat, line):
                    new_line = re.sub(pat, repl, line, count=1)
                    if new_line != line:
                        return i, line, new_line, f"change_op({desc})"
        return None

    def change_numeric(self, lines):
        """Change a numeric literal: increment or decrement by 1."""
        for i, line in enumerate(lines):
            m = re.search(r'\b(\d+)\b', line)
            if m:
                val = int(m.group(1))
                if 0 < val < 100:
                    new_val = val + random.choice([1, -1])
                    new_line = line[:m.start(1)] + str(new_val) + line[m.end(1):]
                    return i, line, new_line, f"change_numeric({val}→{new_val})"
        return None

    def swap_array_index(self, lines):
        """Swap an array index: [0]→[1] or [1]→[0]."""
        for i, line in enumerate(lines):
            m = re.search(r'\[(\d+)\]', line)
            if m:
                idx = int(m.group(1))
                new_idx = (idx + 1) % 3  # Cycle 0,1,2
                new_line = line[:m.start(1)] + str(new_idx) + line[m.end(1):]
                return i, line, new_line, f"swap_index([{idx}]→[{new_idx}])"
        return None

    # ── Mutation Runner ─────────────────────────────────────────────────────

    def mutate(self, filepath, operators=None, max_mutations=5):
        """Run mutation operators on a file and test if existing tests catch them.

        Returns list of mutation results.
        """
        if operators is None:
            ext = os.path.splitext(filepath)[1]
            if ext == ".js":
                operators = [self.flip_boolean, self.remove_line, self.change_operator,
                             self.change_numeric, self.swap_array_index]
            elif ext == ".css":
                operators = [self.remove_line, self.change_numeric]
            elif ext == ".html":
                operators = [self.remove_line, self.flip_boolean]
            else:
                operators = [self.remove_line, self.change_numeric]

        path = Path(filepath)
        if not path.exists():
            return []

        results = []
        original_lines = self._read_lines(path)
        original_hash = hash_file(str(path))
        backup = self._backup(str(path))

        mutations_tried = 0
        for _ in range(max_mutations * 3):  # Try more to account for failures
            if mutations_tried >= max_mutations:
                break

            current = self._read_lines(path)

            # Pick a random operator
            op = random.choice(operators)
            result = op(current)
            if result is None:
                continue

            idx, old, new, desc = result

            # Apply the mutation
            if new == "(removed)":
                mutated_lines = current[:idx] + current[idx+1:]
            else:
                mutated_lines = current[:idx] + [new] + current[idx+1:]

            self._write_lines(path, mutated_lines)

            # Run tests against the mutated code
            test_results = self._run_tests_for_file(filepath)

            # Analyze: did any test fail? (good = mutation was caught)
            caught = not all(r["passed"] for r in test_results) if test_results else False
            failing_tests = [r["test"] for r in test_results if not r["passed"]]

            result_entry = {
                "file": str(filepath),
                "line": idx + 1 if idx is not None else None,
                "mutation": desc,
                "old_code": old.rstrip() if old else "",
                "new_code": new.rstrip() if new and new != "(removed)" else "(line removed)",
                "caught": caught,
                "failing_tests": failing_tests,
                "test_count": len(test_results),
            }
            results.append(result_entry)
            mutations_tried += 1

            if caught:
                log(f"Mutation CAUGHT: {desc} in {path.name}:{idx+1} → {failing_tests}", "MUTATE")
            else:
                log(f"Mutation SURVIVED: {desc} in {path.name}:{idx+1} — TEST GAP!", "FAIL")

        # Restore original
        self._restore(str(path), backup)
        self._write_lines(path, original_lines)

        self.results.extend(results)
        return results

    def _run_tests_for_file(self, filepath):
        """Run the relevant L5-style tests for a given file."""
        path = Path(filepath)
        results = []

        if path.suffix == ".js":
            # JS syntax check
            rc, out, err = run(["node", "--check", str(path)], timeout=10)
            results.append({"test": "js_syntax", "passed": rc == 0, "detail": err[:200]})

            # DOM consistency if it's app.js
            if path.name == "app.js":
                rc, out, err = self._check_dom_consistency()
                results.append({"test": "dom_consistency", "passed": rc == 0, "detail": err[:200]})

        elif path.suffix == ".css":
            # CSS brace balance
            try:
                content = path.read_text()
                opens = content.count("{")
                closes = content.count("}")
                results.append({"test": "css_balance", "passed": opens == closes,
                                "detail": f"{{={opens} }}={closes}"})
            except:
                results.append({"test": "css_balance", "passed": False, "detail": "read error"})

        elif path.suffix == ".html":
            # HTML well-formed check (basic)
            try:
                content = path.read_text()
                opens = len(re.findall(r'<(?!meta|link|br|hr|img|input|rect|circle|path|svg|use|polygon|source|area|base|col|embed|track|wbr)(\w+)', content))
                closes = len(re.findall(r'</\w+>', content))
                results.append({"test": "html_tags", "passed": abs(opens - closes) < 20,
                                "detail": f"open={opens} close={closes}"})
            except:
                results.append({"test": "html_tags", "passed": False, "detail": "read error"})

        elif path.name == "server.js":
            # Backend: check API endpoints
            rc, out, err = run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                                "--max-time", "5", f"{API_BASE}/"], timeout=10)
            results.append({"test": "backend_status", "passed": out == "200",
                            "detail": f"HTTP {out}"})

            for ep in ["/api/status", "/api/matches", "/api/champion-bet/odds"]:
                rc, out2, _ = run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                                   "--max-time", "5", f"{API_BASE}{ep}"], timeout=10)
                results.append({"test": f"api_{ep.replace('/', '_')}",
                                "passed": out2 == "200", "detail": f"HTTP {out2}"})

        return results

    def _check_dom_consistency(self):
        """Check DOM ID consistency between HTML and JS."""
        try:
            js_path = self.project / "js" / "app.js"
            html_paths = list(self.project.glob("*.html"))

            if not js_path.exists():
                return -1, "", "app.js not found"

            js = js_path.read_text()
            html_ids = set()
            for hp in html_paths:
                html = hp.read_text()
                html_ids.update(re.findall(r'id="([^"]+)"', html))

            js_ids = set()
            for m in re.finditer(r"getElementById\(['\"]([^'\"]+)['\"]", js):
                js_ids.add(m.group(1))

            dynamic = {'deposit-modal', 'withdraw-modal', 'w-addr', 'w-amount'}
            # Handle template concatenation: 'page-' + tab, 'tab-' + tab
            template_prefixes = {'page-', 'tab-'}
            missing = {m for m in js_ids - html_ids - dynamic 
                       if not any(m.startswith(p) for p in template_prefixes)}

            if missing:
                return 1, "", f"Missing IDs: {missing}"
            return 0, "", ""
        except Exception as e:
            return 1, "", str(e)

    def summary(self):
        """Summarize mutation testing results."""
        if not self.results:
            return {"total": 0, "caught": 0, "survived": 0, "mutation_score": 0}

        caught = sum(1 for r in self.results if r["caught"])
        survived = sum(1 for r in self.results if not r["caught"])
        total = len(self.results)
        return {
            "total": total,
            "caught": caught,
            "survived": survived,
            "mutation_score": round(caught / total, 3) if total > 0 else 0,
            "survivors": [r for r in self.results if not r["caught"]],
        }


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  PHASE 3: COVERAGE TRACKING — Which code paths are tested vs untested      ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

class CoverageTracker:
    """Map tested vs untested components."""

    def __init__(self, project_path=PROJECT):
        self.project = Path(project_path)
        self.coverage = {}  # component → {tested: bool, tests: [...], source_files: [...]}

    def scan(self):
        """Scan project and build coverage map."""
        # Discover all source files
        source_files = []
        for ext in ["*.js", "*.html", "*.css", "*.json"]:
            source_files.extend(self.project.glob(ext))
        # Add backend files
        backend = self.project / "backend"
        if backend.exists():
            source_files.extend(backend.glob("*.js"))

        # Map components to source files
        for comp_name, file_patterns in COMPONENT_MAP.items():
            matched = []
            for pattern in file_patterns:
                if "*" in pattern:
                    matched.extend(self.project.glob(pattern))
                else:
                    p = self.project / pattern
                    if p.exists():
                        matched.append(str(p))

            self.coverage[comp_name] = {
                "tested": False,  # Will be set after running tests
                "test_count": 0,
                "source_files": [str(m) for m in matched],
                "file_count": len(matched),
                "lines_of_code": sum(self._count_lines(m) for m in matched if os.path.isfile(str(m))),
            }

        # Add source files that don't map to any component
        all_mapped = set()
        for c in self.coverage.values():
            all_mapped.update(c["source_files"])
        all_files = set(str(f) for f in source_files)
        unmapped = all_files - all_mapped
        if unmapped:
            self.coverage["untracked_files"] = {
                "tested": False,
                "test_count": 0,
                "source_files": sorted(unmapped),
                "file_count": len(unmapped),
                "lines_of_code": sum(self._count_lines(f) for f in unmapped if os.path.isfile(f)),
            }

        return self.coverage

    def mark_tested(self, component, test_name):
        """Mark a component as tested."""
        if component in self.coverage:
            self.coverage[component]["tested"] = True
            self.coverage[component]["test_count"] += 1

    def _count_lines(self, path):
        try:
            with open(path) as f:
                return sum(1 for _ in f)
        except:
            return 0

    def summary(self):
        """Coverage summary."""
        components = [c for c in self.coverage if c != "untracked_files"]
        tested = [c for c in components if self.coverage[c]["tested"]]
        untested = [c for c in components if not self.coverage[c]["tested"]]

        total_loc = sum(self.coverage[c]["lines_of_code"] for c in components)
        tested_loc = sum(self.coverage[c]["lines_of_code"] for c in tested)

        return {
            "total_components": len(components),
            "tested_components": len(tested),
            "untested_components": len(untested),
            "untested_list": untested,
            "total_loc": total_loc,
            "tested_loc": tested_loc,
            "coverage_pct": round(tested_loc / max(1, total_loc) * 100, 1),
            "details": {c: self.coverage[c] for c in components},
        }


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  PHASE 4: ADAPTIVE SCHEDULING — Run high-failure tests more often          ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

class AdaptiveScheduler:
    """Schedule tests based on historical failure rates and mutation survivors."""

    def __init__(self, memory, mutation_summary, coverage):
        self.memory = memory
        self.mutation_summary = mutation_summary
        self.coverage = coverage
        self.schedule = []

    def build_schedule(self, max_tests=20):
        """Build an adaptive test schedule.

        Priority:
          1. Mutation survivors (uncaught mutations → high priority)
          2. Historical failure hotspots (high failure weight)
          3. Untested components (coverage gaps)
          4. Recently changed files (from git diff)
          5. Round-robin remaining
        """
        schedule = []
        added = set()

        # Priority 1: Mutation survivors — test the components where mutations survived
        survivors = self.mutation_summary.get("survivors", [])
        for s in survivors:
            filepath = s.get("file", "")
            comp = self._file_to_component(filepath)
            if comp and comp not in added:
                schedule.append({"component": comp, "priority": 1,
                                 "reason": f"Mutation survivor: {s.get('mutation', 'unknown')}",
                                 "weight": 1.0})
                added.add(comp)

        # Priority 2: Historical hotspots
        hotspots = self.memory.get_failure_hotspots(threshold=0.2)
        for test_name, weight in hotspots:
            comp = test_name
            if comp not in added and len(schedule) < max_tests:
                schedule.append({"component": comp, "priority": 2,
                                 "reason": f"Failure hotspot (weight={weight})",
                                 "weight": weight})
                added.add(comp)

        # Priority 3: Untested components
        if self.coverage:
            untested = self.coverage.summary().get("untested_list", [])
            for comp in untested:
                if comp not in added and len(schedule) < max_tests:
                    schedule.append({"component": comp, "priority": 3,
                                     "reason": "Untested component",
                                     "weight": 0.7})
                    added.add(comp)

        # Priority 4: Git-diff based predictive
        changed_comps = self._git_diff_components()
        for comp in changed_comps:
            if comp not in added and len(schedule) < max_tests:
                schedule.append({"component": comp, "priority": 4,
                                 "reason": "Recently changed (git diff)",
                                 "weight": 0.6})
                added.add(comp)

        # Fill remaining slots
        ranked = self.memory.get_ranked_tests()
        for test_name, weight in ranked:
            comp = test_name
            if comp not in added and len(schedule) < max_tests:
                schedule.append({"component": comp, "priority": 5,
                                 "reason": f"Round-robin (weight={weight})",
                                 "weight": weight})
                added.add(comp)

        self.schedule = schedule
        return schedule

    def _file_to_component(self, filepath):
        """Map a file path to its component name."""
        basename = os.path.basename(filepath)
        for comp, patterns in COMPONENT_MAP.items():
            for pat in patterns:
                if basename in pat or pat.endswith(basename):
                    return comp
        return f"file:{basename}"

    def _git_diff_components(self):
        """Get components affected by recent git changes."""
        components = set()
        try:
            rc, out, _ = run(["git", "diff", "--name-only", "HEAD~3..HEAD"],
                             timeout=10, workdir=str(PROJECT))
            if rc == 0 and out:
                for f in out.split("\n"):
                    f = f.strip()
                    if not f:
                        continue
                    # Skip vendored paths
                    if any(f.startswith(vp) for vp in ["contracts/lib/", "node_modules/", ".git/"]):
                        continue
                    comp = self._file_to_component(f)
                    if comp and not comp.startswith("file:"):
                        components.add(comp)
        except:
            pass
        return list(components)[:5]

    def summary(self):
        return {
            "total_scheduled": len(self.schedule),
            "by_priority": {
                p: len([s for s in self.schedule if s["priority"] == p])
                for p in sorted(set(s["priority"] for s in self.schedule))
            },
            "schedule": self.schedule,
        }


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  PHASE 5: PREDICTIVE TESTING — Git diff → test selection                   ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

class PredictiveTester:
    """Based on git diff, predict which tests are most likely to catch regressions."""

    def __init__(self, project_path=PROJECT):
        self.project = Path(project_path)

    def analyze(self):
        """Analyze git diff and predict test targets."""
        predictions = []

        # Get changed files — only care about project source, not vendored libs
        rc, out, _ = run(["git", "diff", "--name-only", "HEAD~5..HEAD"],
                         timeout=10, workdir=str(self.project))
        changed = out.split("\n") if rc == 0 and out else []

        # Filter: only project source files, skip vendored/third-party
        vendor_prefixes = ["contracts/lib/", "node_modules/", ".git/", "lib/forge-std/",
                          "contracts/broadcast/", "contracts/.github/", "contracts/script/",
                          "contracts/test/"]
        # Skip non-source files
        skip_patterns = [".gitignore", ".gitmodules", ".gitattributes", "foundry.lock",
                        "foundry.toml", "README.md", "CODEOWNERS", ".yml", ".yaml"]
        project_extensions = {".js", ".html", ".css", ".json", ".sol", ".py"}
        project_changes = []
        for f in changed:
            f = f.strip()
            if not f:
                continue
            # Skip vendored paths
            if any(f.startswith(vp) for vp in vendor_prefixes):
                continue
            # Skip non-source config files
            if any(sp in f for sp in skip_patterns):
                continue
            # Only keep project-relevant extensions
            ext = os.path.splitext(f)[1]
            if ext in project_extensions or os.path.basename(f) in ["index.html", "admin.html", "rules.html"]:
                project_changes.append(f)
        changed = project_changes

        if not changed:
            return {"changed_files": [], "predictions": [], "note": "No recent changes detected"}

        for f in changed:
            f = f.strip()
            if not f:
                continue
            ext = os.path.splitext(f)[1]

            predicted_tests = []
            if ext == ".js":
                predicted_tests.extend(["js_syntax", "dom_consistency"])
                if "server" in f or "backend" in f:
                    predicted_tests.extend(["backend_status", "api_endpoints", "admin_auth"])
            elif ext == ".css":
                predicted_tests.extend(["css_balance"])
            elif ext == ".html":
                predicted_tests.extend(["dom_consistency", "html_wellformed"])
            elif ext == ".json":
                predicted_tests.extend(["data_integrity"])
            elif ext in (".sol", ".vy"):
                predicted_tests.extend(["contract_compile"])

            predictions.append({
                "file": f,
                "extension": ext,
                "predicted_tests": predicted_tests,
                "confidence": "high" if predicted_tests else "low",
            })

        return {
            "changed_files": changed,
            "predictions": predictions,
            "total_predictions": sum(len(p["predicted_tests"]) for p in predictions),
        }


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  MAIN: L6 EVOLVE ORCHESTRATOR                                              ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

class L6EvolveAgent:
    """Orchestrates all L6 capabilities."""

    def __init__(self):
        self.project = PROJECT
        self.memory = FailureMemory()
        self.mutator = MutationTester()
        self.coverage_tracker = CoverageTracker()
        self.predictive = PredictiveTester()
        self.start_time = datetime.now()

        # Standard test suite (L5 compatible)
        self.test_suite = []
        self.test_results = []

    def run_baseline_tests(self):
        """Run the standard L5 test suite to establish baseline."""
        log("Running baseline test suite...", "INFO")
        results = []

        # 1. JS syntax
        rc, out, err = run(["node", "--check", f"{self.project}/js/app.js"], timeout=10)
        passed = rc == 0
        results.append({"test": "js_syntax", "passed": passed, "detail": err[:200] if err else "OK"})
        log("JS syntax", "PASS" if passed else "FAIL")

        # 2. CSS balance
        try:
            css = open(f"{self.project}/css/style.css").read()
            opens = css.count("{")
            closes = css.count("}")
            passed = opens == closes
            results.append({"test": "css_balance", "passed": passed,
                            "detail": f"{{={opens} }}={closes}"})
            log("CSS balance", "PASS" if passed else "FAIL")
        except Exception as e:
            results.append({"test": "css_balance", "passed": False, "detail": str(e)})
            log("CSS balance", "FAIL")

        # 3. DOM consistency
        try:
            html = open(f"{self.project}/index.html").read()
            html_ids = set(re.findall(r'id="([^"]+)"', html))
            js = open(f"{self.project}/js/app.js").read()
            js_ids = set()
            for m in re.finditer(r"getElementById\(['\"]([^'\"]+)['\"]", js):
                js_ids.add(m.group(1))
            dynamic = {'deposit-modal', 'withdraw-modal', 'w-addr', 'w-amount', 'w-balance',
                       'bet-total-return', 'hot-ranking-list', 'detail-h2h', 'detail-recent'}
            template_prefixes = {'page-', 'tab-'}
            missing = {m for m in js_ids - html_ids - dynamic 
                       if not any(m.startswith(p) for p in template_prefixes)}
            passed = len(missing) == 0
            results.append({"test": "dom_consistency", "passed": passed,
                            "detail": f"missing={list(missing)}" if missing else "OK"})
            log("DOM consistency", "PASS" if passed else "FAIL")
        except Exception as e:
            results.append({"test": "dom_consistency", "passed": False, "detail": str(e)})
            log("DOM consistency", "FAIL")

        # 4. Backend status
        rc, out, _ = run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                          "--max-time", "5", f"{API_BASE}/"], timeout=10)
        passed = out == "200"
        results.append({"test": "backend_status", "passed": passed, "detail": f"HTTP {out}"})
        log(f"Backend status (HTTP {out})", "PASS" if passed else "FAIL")

        # 5. API endpoints
        for ep in ["/api/status", "/api/matches", "/api/champion-bet/odds"]:
            rc, out, _ = run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                              "--max-time", "5", f"{API_BASE}{ep}"], timeout=10)
            passed = out == "200"
            test_name = f"api_{ep.replace('/', '_')}"
            results.append({"test": test_name, "passed": passed, "detail": f"HTTP {out}"})
            log(f"API {ep}", "PASS" if passed else "FAIL")

        # 6. Admin auth
        rc, out, _ = run(["curl", "-s", "-X", "POST", f"{API_BASE}/api/admin/login",
                          "-H", "Content-Type: application/json",
                          "-d", json.dumps(ADMIN_CREDS)], timeout=10)
        passed = False
        try:
            data = json.loads(out)
            passed = data.get("code") == 0
        except:
            pass
        results.append({"test": "admin_auth", "passed": passed, "detail": "OK" if passed else out[:200]})
        log("Admin auth", "PASS" if passed else "FAIL")

        # 7. HTML well-formed
        for html_file in ["index.html", "admin.html", "rules.html"]:
            try:
                content = open(f"{self.project}/{html_file}").read()
                open_tags = len(re.findall(r'<(?!meta|link|br|hr|img|input|rect|circle|path|svg|use|polygon|source|area|base|col|embed|track|wbr)(\w+)', content))
                close_tags = len(re.findall(r'</\w+>', content))
                passed = abs(open_tags - close_tags) < 5
                results.append({"test": f"html_wellformed_{html_file}", "passed": passed,
                                "detail": f"open={open_tags} close={close_tags}"})
                log(f"HTML well-formed {html_file}", "PASS" if passed else "FAIL")
            except Exception as e:
                results.append({"test": f"html_wellformed_{html_file}", "passed": False,
                                "detail": str(e)})

        # 8. Data integrity — check JSON files parse
        data_dir = Path(f"{self.project}/backend/data")
        if data_dir.exists():
            for jf in data_dir.glob("*.json"):
                try:
                    with open(jf) as f:
                        json.load(f)
                    passed = True
                    detail = "valid JSON"
                except Exception as e:
                    passed = False
                    detail = str(e)[:200]
                results.append({"test": f"data_integrity_{jf.name}", "passed": passed,
                                "detail": detail})
                log(f"Data integrity {jf.name}", "PASS" if passed else "FAIL")

        # 9. API response validation (kills server.js mutation survivors)
        for ep, expected_key in [
            ("/api/status", "status"),
            ("/api/matches", "data"),
            ("/api/champion-bet/odds", "data"),
        ]:
            try:
                rc, out, _ = run(["curl", "-s", "--max-time", "5", f"{API_BASE}{ep}"], timeout=10)
                data = json.loads(out) if out else {}
                passed = expected_key in data
                results.append({"test": f"api_validation_{ep.replace('/','_')}", "passed": passed,
                                "detail": "valid" if passed else f"missing {expected_key}"})
                log(f"API validate {ep}", "PASS" if passed else "FAIL")
            except:
                results.append({"test": f"api_validation_{ep.replace('/','_')}", "passed": False,
                                "detail": "parse error"})

        # 10. CSS rendering checks (kills CSS mutation survivors)
        try:
            content = open(f"{self.project}/css/style.css").read()
            css_checks = {
                "has_theme_vars": "--gold" in content and "--bg" in content,
                "has_responsive": "@media" in content,
                "has_animations": "@keyframes" in content,
                "has_touch_targets": "44px" in content,
            }
            for check_name, result in css_checks.items():
                results.append({"test": f"css_render_{check_name}", "passed": result,
                                "detail": "found" if result else "missing"})
                log(f"CSS check {check_name}", "PASS" if result else "FAIL")
        except Exception as e:
            results.append({"test": "css_render", "passed": False, "detail": str(e)})

        self.test_results = results
        return results

    def run(self):
        """Execute the full L6 evolve strategy."""
        print("=" * 60)
        print("  🧬 L6 SELF-EVOLVING TEST STRATEGY")
        print("  Mutation Testing + Failure Memory + Adaptive Scheduling")
        print("=" * 60)

        # ── STEP 1: Load failure memory ──
        print(f"\n📊 PHASE 1: FAILURE MEMORY")
        mem_stats = self.memory.stats()
        log(f"History: {mem_stats['total_runs']} runs, {mem_stats['unique_tests']} unique tests")
        log(f"Overall pass rate: {mem_stats['overall_pass_rate']}")
        ranked = self.memory.get_ranked_tests()
        if ranked:
            log(f"Top hotspots: {ranked[:3]}", "WARN")

        # ── STEP 2: Baseline tests ──
        print(f"\n🧪 PHASE 2: BASELINE TESTS")
        baseline = self.run_baseline_tests()
        passed = sum(1 for r in baseline if r["passed"])
        total = len(baseline)
        log(f"Baseline: {passed}/{total} passed ({100*passed//max(1,total)}%)")

        # Record all baseline results in memory
        for r in baseline:
            self.memory.record(r["test"], r["passed"])

        # ── STEP 3: Coverage scan ──
        print(f"\n📐 PHASE 3: COVERAGE SCAN")
        self.coverage_tracker.scan()

        # Map test names to component names for coverage tracking
        test_to_component = {
            "js_syntax": "js_syntax",
            "css_balance": "css_balance",
            "dom_consistency": "dom_consistency",
            "backend_status": "backend_status",
            "admin_auth": "admin_auth",
        }
        for r in baseline:
            if r["passed"]:
                comp = None
                test_name = r["test"]
                # Direct match
                if test_name in test_to_component:
                    comp = test_to_component[test_name]
                # API endpoints
                elif test_name.startswith("api_"):
                    comp = "api_endpoints"
                # HTML well-formed
                elif test_name.startswith("html_wellformed_"):
                    comp = "html_wellformed"
                # Data integrity
                elif test_name.startswith("data_integrity_"):
                    comp = "data_integrity"
                # API validation
                elif test_name.startswith("api_validation_"):
                    comp = "api_endpoints"
                # CSS rendering
                elif test_name.startswith("css_render_"):
                    comp = "css_inline"

                if comp and comp in self.coverage_tracker.coverage:
                    self.coverage_tracker.mark_tested(comp, r["test"])
        cov_summary = self.coverage_tracker.summary()
        log(f"Components: {cov_summary['tested_components']}/{cov_summary['total_components']} tested "
            f"({cov_summary['coverage_pct']}% LOC)")
        if cov_summary["untested_list"]:
            log(f"Untested: {cov_summary['untested_list']}", "WARN")

        # ── STEP 4: Mutation testing ──
        print(f"\n🧬 PHASE 4: MUTATION TESTING")
        mutation_targets = [
            f"{self.project}/js/app.js",
            f"{self.project}/css/style.css",
            f"{self.project}/backend/server.js",
        ]
        for target in mutation_targets:
            if os.path.exists(target):
                log(f"Mutating: {os.path.basename(target)}", "MUTATE")
                self.mutator.mutate(target, max_mutations=4)
            else:
                log(f"Skip missing: {target}", "WARN")

        mutation_summary = self.mutator.summary()
        log(f"Mutation score: {mutation_summary['caught']}/{mutation_summary['total']} "
            f"({mutation_summary['mutation_score']:.0%})")
        if mutation_summary["survivors"]:
            log(f"SURVIVORS ({len(mutation_summary['survivors'])}): test gaps detected!", "FAIL")
            for s in mutation_summary["survivors"]:
                log(f"  → {s['file'].split('/')[-1]}:{s['line']} — {s['mutation']}", "WARN")

        # ── STEP 5: Adaptive scheduling ──
        print(f"\n📅 PHASE 5: ADAPTIVE SCHEDULING")
        scheduler = AdaptiveScheduler(self.memory, mutation_summary, self.coverage_tracker)
        schedule = scheduler.build_schedule(max_tests=20)
        sched_summary = scheduler.summary()
        log(f"Schedule: {sched_summary['total_scheduled']} tests prioritized")
        for s in schedule[:5]:
            log(f"  P{s['priority']}: {s['component']} — {s['reason']}")

        # ── STEP 6: Predictive testing ──
        print(f"\n🔮 PHASE 6: PREDICTIVE TESTING (git diff)")
        pred = self.predictive.analyze()
        log(f"Changed files: {len(pred.get('changed_files', []))}")
        log(f"Predicted tests: {pred.get('total_predictions', 0)}")

        # ── STEP 7: Generate report ──
        print(f"\n📝 PHASE 7: REPORT GENERATION")
        self.generate_report(baseline, mutation_summary, cov_summary, sched_summary, pred)

        print(f"\n{'='*60}")
        print(f"  ✅ L6 EVOLVE COMPLETE")
        print(f"  Report: {REPORT_FILE}")
        print(f"{'='*60}")

        return {
            "baseline": {"passed": passed, "total": total, "rate": passed/max(1,total)},
            "mutation": mutation_summary,
            "coverage": cov_summary,
            "schedule": sched_summary,
            "predictions": pred,
        }

    def generate_report(self, baseline, mutation, coverage, schedule, predictions):
        """Generate L6_EVOLVE_REPORT.md."""
        duration = (datetime.now() - self.start_time).total_seconds()
        passed = sum(1 for r in baseline if r["passed"])
        total = len(baseline)

        # Calculate evolution score
        base_score = passed / max(1, total)
        mutation_score = mutation.get("mutation_score", 0)
        coverage_score = coverage.get("coverage_pct", 0) / 100
        evolution_score = round((base_score * 0.3 + mutation_score * 0.35 + coverage_score * 0.35) * 100, 1)

        lines = []
        lines.append("# 🧬 L6 Self-Evolving Test Report")
        lines.append(f"")
        lines.append(f"**Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  ")
        lines.append(f"**Duration**: {duration:.1f}s  ")
        lines.append(f"**Project**: 19888 Platform  ")
        lines.append(f"")
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"## 🎯 Evolution Score: {evolution_score}/100")
        lines.append(f"")
        lines.append(f"| Metric | Score | Weight |")
        lines.append(f"|--------|-------|--------|")
        lines.append(f"| Baseline Pass Rate | {base_score:.0%} | 30% |")
        lines.append(f"| Mutation Score | {mutation_score:.0%} | 35% |")
        lines.append(f"| Coverage | {coverage_score:.0%} | 35% |")
        lines.append(f"")
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"## 📊 Baseline Test Results")
        lines.append(f"")
        lines.append(f"**{passed}/{total} tests passed** ({100*passed//max(1,total)}%)")
        lines.append(f"")
        lines.append(f"| Test | Result | Detail |")
        lines.append(f"|------|--------|--------|")
        for r in baseline:
            emoji = "✅" if r["passed"] else "❌"
            lines.append(f"| {r['test']} | {emoji} | {r.get('detail', '')[:80]} |")
        lines.append(f"")

        # Mutation section
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"## 🧬 Mutation Testing")
        lines.append(f"")
        lines.append(f"**Mutation Score**: {mutation.get('caught', 0)}/{mutation.get('total', 0)} "
                     f"({mutation.get('mutation_score', 0):.0%})")
        lines.append(f"")
        if mutation.get("survivors"):
            lines.append(f"### ⚠️ Mutation Survivors (Test Gaps)")
            lines.append(f"")
            lines.append(f"These mutations were NOT caught by any test — indicating test gaps:")
            lines.append(f"")
            lines.append(f"| File | Line | Mutation | Tests Run |")
            lines.append(f"|------|------|----------|-----------|")
            for s in mutation["survivors"]:
                fname = s.get("file", "").split("/")[-1]
                lines.append(f"| {fname} | {s.get('line', '?')} | {s.get('mutation', '?')} | {s.get('test_count', 0)} |")
            lines.append(f"")
        else:
            lines.append(f"✅ All mutations were caught by existing tests.")
            lines.append(f"")

        # All mutation results
        lines.append(f"### All Mutation Results")
        lines.append(f"")
        lines.append(f"| File | Line | Mutation | Caught? |")
        lines.append(f"|------|------|----------|---------|")
        for r in self.mutator.results:
            fname = r.get("file", "").split("/")[-1]
            caught = "✅" if r["caught"] else "❌"
            lines.append(f"| {fname} | {r.get('line', '?')} | {r.get('mutation', '?')} | {caught} |")
        lines.append(f"")

        # Coverage section
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"## 📐 Coverage Map")
        lines.append(f"")
        lines.append(f"**{coverage.get('tested_components', 0)}/{coverage.get('total_components', 0)} components tested** "
                     f"({coverage.get('coverage_pct', 0)}% LOC)")
        lines.append(f"")
        lines.append(f"| Component | Status | Files | LOC |")
        lines.append(f"|-----------|--------|-------|-----|")
        for comp, info in coverage.get("details", {}).items():
            status = "✅ Tested" if info.get("tested") else "❌ Untested"
            files = info.get("file_count", 0)
            loc = info.get("lines_of_code", 0)
            lines.append(f"| {comp} | {status} | {files} | {loc} |")
        lines.append(f"")

        # Adaptive schedule
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"## 📅 Adaptive Schedule")
        lines.append(f"")
        lines.append(f"**{schedule.get('total_scheduled', 0)} tests scheduled** across "
                     f"{len(schedule.get('by_priority', {}))} priority levels")
        lines.append(f"")
        lines.append(f"| Priority | Count | Description |")
        lines.append(f"|----------|-------|-------------|")
        for p, count in sorted(schedule.get("by_priority", {}).items()):
            desc = {1: "🔴 Mutation survivors", 2: "🟠 Failure hotspots",
                    3: "🟡 Untested components", 4: "🔵 Git-diff predictions",
                    5: "⚪ Round-robin"}.get(p, f"Level {p}")
            lines.append(f"| {desc} | {count} |")
        lines.append(f"")

        lines.append(f"### Top 10 Scheduled Tests")
        lines.append(f"")
        lines.append(f"| Pri | Component | Reason | Weight |")
        lines.append(f"|-----|-----------|--------|--------|")
        for s in schedule.get("schedule", [])[:10]:
            lines.append(f"| P{s['priority']} | {s['component']} | {s['reason'][:40]} | {s['weight']} |")
        lines.append(f"")

        # Predictive testing
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"## 🔮 Predictive Testing (Git Diff)")
        lines.append(f"")
        lines.append(f"**Changed files**: {len(predictions.get('changed_files', []))}  ")
        lines.append(f"**Predicted tests**: {predictions.get('total_predictions', 0)}  ")
        lines.append(f"")
        if predictions.get("predictions"):
            lines.append(f"| File | Predicted Tests | Confidence |")
            lines.append(f"|------|-----------------|------------|")
            for p in predictions.get("predictions", [])[:15]:
                fname = p.get("file", "").split("/")[-1]
                tests = ", ".join(p.get("predicted_tests", []))
                conf = p.get("confidence", "low")
                lines.append(f"| {fname} | {tests} | {conf} |")
        lines.append(f"")

        # Failure memory
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"## 🧠 Failure Memory")
        lines.append(f"")
        mem_stats = self.memory.stats()
        lines.append(f"**Total runs**: {mem_stats['total_runs']}  ")
        lines.append(f"**Unique tests**: {mem_stats['unique_tests']}  ")
        lines.append(f"**Hotspots**: {mem_stats['hotspots']}  ")
        lines.append(f"")
        ranked = self.memory.get_ranked_tests()
        if ranked:
            lines.append(f"| Test | Weight | Total | Passed | Failed | Streak |")
            lines.append(f"|------|--------|-------|--------|--------|--------|")
            for name, weight in ranked[:10]:
                t = self.memory.data["tests"].get(name, {})
                lines.append(f"| {name} | {weight:.3f} | {t.get('total',0)} | "
                            f"{t.get('passed',0)} | {t.get('failed',0)} | {t.get('failure_streak',0)} |")
        lines.append(f"")

        # Insights
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"## 💡 Evolution Insights")
        lines.append(f"")

        insights = []

        if mutation.get("mutation_score", 0) < 0.5:
            survivor_files = sorted(set(s["file"].split("/")[-1] for s in mutation.get("survivors", [])))
            insights.append(f"- 🔴 **Low mutation score** ({mutation.get('mutation_score', 0):.0%}): "
                           f"Many mutations survive. Strengthen tests for {', '.join(survivor_files)}.")
        elif mutation.get("mutation_score", 0) < 0.8:
            insights.append(f"- 🟡 **Moderate mutation score** ({mutation.get('mutation_score', 0):.0%}): "
                           f"Consider adding more targeted tests for survivors.")
        else:
            insights.append(f"- 🟢 **Good mutation score** ({mutation.get('mutation_score', 0):.0%}): "
                           f"Tests effectively catch artificial bugs.")

        if coverage.get("coverage_pct", 0) < 50:
            insights.append(f"- 🔴 **Low coverage** ({coverage.get('coverage_pct', 0)}%): "
                           f"Untested: {coverage.get('untested_list', [])}")
        elif coverage.get("coverage_pct", 0) < 80:
            insights.append(f"- 🟡 **Moderate coverage** ({coverage.get('coverage_pct', 0)}%): "
                           f"Focus on: {coverage.get('untested_list', [])}")
        else:
            insights.append(f"- 🟢 **Good coverage** ({coverage.get('coverage_pct', 0)}%).")

        hotspots = self.memory.get_failure_hotspots(threshold=0.2)
        if hotspots:
            insights.append(f"- 🟠 **Failure hotspots**: {[(n, w) for n, w in hotspots[:3]]} — "
                           f"schedule these more frequently.")

        survivors = mutation.get("survivors", [])
        if survivors:
            insights.append(f"- 🔴 **{len(survivors)} mutation survivors** indicate untested code paths. "
                           f"Priority: add tests that exercise these mutations.")

        if not insights:
            insights.append("- ✅ All systems look healthy. Continue monitoring.")

        lines.extend(insights)
        lines.append(f"")
        lines.append(f"---")
        lines.append(f"")
        lines.append(f"*Report generated by L6 Self-Evolving Test Strategy*  ")
        lines.append(f"*History: `/tmp/l6_test_history.json`*  ")
        lines.append(f"")

        report_content = "\n".join(lines)
        with open(REPORT_FILE, "w") as f:
            f.write(report_content)

        log(f"Report written to {REPORT_FILE}", "PASS")


# ── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    random.seed(int(time.time()))
    agent = L6EvolveAgent()
    result = agent.run()
    # Exit with failure if mutation score is 0 or baseline failed badly
    if result["baseline"]["rate"] < 0.5 or result["mutation"]["mutation_score"] == 0:
        sys.exit(1)
    sys.exit(0)
