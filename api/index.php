<?php
/**
 * 19888 API - Simple PHP Backend
 * Handles: wallet auth, matches, bets, user data
 * Storage: JSON files (no DB required for MVP)
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Router ──────────────────────────────────────
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri = rtrim($uri, '/');
$method = $_SERVER['REQUEST_METHOD'];

// Remove /api prefix if present
if (strpos($uri, '/api') === 0) {
    $uri = substr($uri, 4);
}

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) mkdir($dataDir, 0755, true);

// ── Helpers ─────────────────────────────────────
function jsonFile($name) { global $dataDir; return $dataDir . '/' . $name . '.json'; }
function readJson($name, $default = []) {
    $path = jsonFile($name);
    if (!file_exists($path)) return $default;
    return json_decode(file_get_contents($path), true) ?: $default;
}
function writeJson($name, $data) {
    file_put_contents(jsonFile($name), json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}
function getInput() {
    return json_decode(file_get_contents('php://input'), true) ?: $_POST;
}
function success($data = [], $msg = 'ok') {
    echo json_encode(['code' => 0, 'msg' => $msg, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}
function error($msg = 'error', $code = 1) {
    http_response_code(400);
    echo json_encode(['code' => $code, 'msg' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Seed Data ────────────────────────────────────
function seedMatches() {
    $existing = readJson('matches');
    if (!empty($existing)) return $existing;

    $matches = [
        ['id' => 1, 'league' => '法甲', 'home' => '巴黎圣日耳曼', 'away' => '马赛', 'time' => '2026-06-04 03:00:00', 'odds_home' => 1.82, 'odds_draw' => 3.50, 'odds_away' => 4.20, 'status' => 'upcoming'],
        ['id' => 2, 'league' => '英超', 'home' => '曼城', 'away' => '利物浦', 'time' => '2026-06-04 00:30:00', 'odds_home' => 2.10, 'odds_draw' => 3.30, 'odds_away' => 3.40, 'status' => 'upcoming'],
        ['id' => 3, 'league' => '西甲', 'home' => '皇马', 'away' => '巴萨', 'time' => '2026-06-05 04:00:00', 'odds_home' => 2.40, 'odds_draw' => 3.20, 'odds_away' => 2.90, 'status' => 'upcoming'],
        ['id' => 4, 'league' => '意甲', 'home' => '尤文图斯', 'away' => '国米', 'time' => '2026-06-05 02:45:00', 'odds_home' => 2.15, 'odds_draw' => 3.10, 'odds_away' => 3.50, 'status' => 'upcoming'],
        ['id' => 5, 'league' => '德甲', 'home' => '拜仁慕尼黑', 'away' => '多特蒙德', 'time' => '2026-06-06 01:30:00', 'odds_home' => 1.95, 'odds_draw' => 3.60, 'odds_away' => 3.80, 'status' => 'upcoming'],
        ['id' => 6, 'league' => '友谊赛', 'home' => '巴西', 'away' => '阿根廷', 'time' => '2026-06-07 08:00:00', 'odds_home' => 2.50, 'odds_draw' => 3.00, 'odds_away' => 2.80, 'status' => 'upcoming'],
        ['id' => 7, 'league' => '欧冠', 'home' => '拜仁', 'away' => '巴黎', 'time' => '2026-06-08 03:00:00', 'odds_home' => 2.20, 'odds_draw' => 3.40, 'odds_away' => 3.10, 'status' => 'upcoming'],
        ['id' => 8, 'league' => '英超', 'home' => '阿森纳', 'away' => '切尔西', 'time' => '2026-06-08 00:30:00', 'odds_home' => 2.05, 'odds_draw' => 3.25, 'odds_away' => 3.60, 'status' => 'upcoming'],
    ];
    writeJson('matches', $matches);

    $teams = [
        ['id' => 1, 'name' => '巴西', 'championship_odds' => 5.50, 'runner_up_odds' => 4.20],
        ['id' => 2, 'name' => '法国', 'championship_odds' => 6.00, 'runner_up_odds' => 4.50],
        ['id' => 3, 'name' => '阿根廷', 'championship_odds' => 7.50, 'runner_up_odds' => 5.50],
        ['id' => 4, 'name' => '英格兰', 'championship_odds' => 8.00, 'runner_up_odds' => 5.80],
        ['id' => 5, 'name' => '西班牙', 'championship_odds' => 9.00, 'runner_up_odds' => 6.50],
        ['id' => 6, 'name' => '德国', 'championship_odds' => 10.00, 'runner_up_odds' => 7.00],
        ['id' => 7, 'name' => '葡萄牙', 'championship_odds' => 12.00, 'runner_up_odds' => 8.00],
        ['id' => 8, 'name' => '荷兰', 'championship_odds' => 15.00, 'runner_up_odds' => 9.50],
    ];
    writeJson('champion_teams', $teams);

    return $matches;
}

seedMatches();

// ── Routes ──────────────────────────────────────

// POST /wallet/connect — Wallet-based login/register
if ($method === 'POST' && $uri === '/wallet/connect') {
    $input = getInput();
    $address = strtolower(trim($input['wallet_address'] ?? ''));
    if (strlen($address) < 10) error('无效的钱包地址');

    $users = readJson('users');
    $found = false;
    foreach ($users as &$u) {
        if (strtolower($u['address']) === $address) {
            $found = true;
            $u['last_login'] = date('Y-m-d H:i:s');
            break;
        }
    }
    unset($u);

    $type = 'login';
    if (!$found) {
        $users[] = [
            'address' => $address,
            'balance' => 0,
            'created_at' => date('Y-m-d H:i:s'),
            'last_login' => date('Y-m-d H:i:s'),
        ];
        $type = 'register';
    }

    writeJson('users', $users);
    success(['address' => $address, 'type' => $type], $type === 'register' ? '注册成功' : '登录成功');
}

// GET /matches — List all matches
if ($method === 'GET' && $uri === '/matches') {
    $matches = readJson('matches');
    success($matches);
}

// GET /matches/{id} — Single match
if ($method === 'GET' && preg_match('#^/matches/(\d+)$#', $uri, $m)) {
    $matches = readJson('matches');
    foreach ($matches as $match) {
        if ($match['id'] == $m[1]) {
            // Generate 18-grid odds
            $grid = [];
            $cells = ['0:0','0:1','0:2','0:3','1:0','1:1','1:2','1:3','2:0','2:1','2:2','2:3','3:0','3:1','3:2','3:3','主4+','客4+'];
            foreach ($cells as $c) {
                $grid[] = ['score' => $c, 'odds' => round(1.5 + mt_rand(0, 800) / 100, 2)];
            }
            $match['grid_18'] = $grid;
            success($match);
        }
    }
    error('比赛不存在', 404);
}

// GET /champion-bet/odds — Champion bet odds
if ($method === 'GET' && $uri === '/champion-bet/odds') {
    $teams = readJson('champion_teams');
    $bets = readJson('bets');
    $totalBet = 0; $totalWin = 0;
    foreach ($bets as $b) {
        if (isset($b['amount'])) {
            $totalBet += $b['amount'];
            $totalWin += $b['amount'] * ($b['odds'] ?? 0);
        }
    }
    success(['odds' => $teams, 'total_bet' => $totalBet, 'total_potential_win' => $totalWin]);
}

// POST /champion-bet/place — Place champion bet
if ($method === 'POST' && $uri === '/champion-bet/place') {
    $input = getInput();
    $teamId = intval($input['team_id'] ?? 0);
    $betType = intval($input['bet_type'] ?? 0); // 1=champion, 2=runner-up
    $amount = floatval($input['amount'] ?? 0);
    $address = strtolower(trim($input['wallet_address'] ?? ''));

    if ($teamId < 1) error('请选择球队');
    if (!in_array($betType, [1, 2])) error('请选择投注类型');
    if ($amount < 1) error('最小投注金额为 1 USDT');
    if (strlen($address) < 10) error('请先连接钱包');

    $teams = readJson('champion_teams');
    $team = null;
    foreach ($teams as $t) { if ($t['id'] == $teamId) { $team = $t; break; } }
    if (!$team) error('球队不存在');

    $odds = $betType === 1 ? $team['championship_odds'] : $team['runner_up_odds'];

    $bets = readJson('bets');
    $bets[] = [
        'id' => count($bets) + 1,
        'address' => $address,
        'team_id' => $teamId,
        'team_name' => $team['name'],
        'bet_type' => $betType,
        'bet_type_name' => $betType === 1 ? '冠军' : '亚军',
        'amount' => $amount,
        'odds' => $odds,
        'potential_win' => round($amount * $odds, 2),
        'status' => 'pending',
        'created_at' => date('Y-m-d H:i:s'),
    ];
    writeJson('bets', $bets);

    success(['bet_id' => count($bets), 'potential_win' => round($amount * $odds, 2)], '投注成功');
}

// GET /bets?address=0x... — User bet history
if ($method === 'GET' && $uri === '/bets') {
    $address = strtolower(trim($_GET['address'] ?? ''));
    if (strlen($address) < 10) error('请提供钱包地址');

    $bets = readJson('bets');
    $userBets = array_filter($bets, function($b) use ($address) {
        return strtolower($b['address']) === $address;
    });

    success(array_values(array_reverse($userBets)));
}

// GET /user/balance?address=0x... — Get user balance
if ($method === 'GET' && $uri === '/user/balance') {
    $address = strtolower(trim($_GET['address'] ?? ''));
    if (strlen($address) < 10) error('请提供钱包地址');

    $users = readJson('users');
    foreach ($users as $u) {
        if (strtolower($u['address']) === $address) {
            success(['address' => $u['address'], 'balance' => $u['balance'] ?? 0]);
        }
    }
    success(['address' => $address, 'balance' => 0]);
}

// GET /status — Health check
if ($method === 'GET' && ($uri === '/status' || $uri === '' || $uri === '/')) {
    success(['status' => 'ok', 'version' => '1.0.0', 'name' => '19888 API']);
}

// 404
error('Not Found: ' . $uri, 404);
