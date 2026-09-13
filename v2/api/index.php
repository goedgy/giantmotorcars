<?php
/* ============================================================
   Giant Motor Cars CRM — V2 API

   One endpoint, addressed as api/?action=…  (a query string, not a
   rewritten path, so it works on any shared host whether or not
   mod_rewrite is available).

     login   POST {email, password}
     logout  POST
     session GET/POST
     select  POST {table, columns, filters, order, range, limit}
     insert  POST {table, rows}
     update  POST {table, patch, filters}
     delete  POST {table, filters}

   Authorisation model: every data action requires a signed-in
   session. The browser never holds a database credential — unlike
   the V1 Supabase build, where a publishable key sat in the page
   and row-level security was the only thing behind it.

   CSRF: the session cookie is SameSite=Strict, and every request
   must carry X-GMC-Request. A cross-origin page cannot set a custom
   header without a CORS preflight, and no CORS headers are sent
   here, so the preflight fails. Two independent defences.
   ============================================================ */

declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/google_auth.php';

const MAX_ROWS          = 5000;   // ceiling on one select
const LOGIN_WINDOW_MIN  = 15;
const LOGIN_MAX_TRIES   = 10;    // per IP
const LOGIN_MAX_ACCOUNT = 5;     // per email address, across every IP

/* Compared against when the address is unknown, so a miss costs the same
   bcrypt work as a hit. Without it the two answers differ by ~100x and the
   form becomes a way to discover which addresses have accounts. */
const DUMMY_HASH = '$2y$12$Ytgejh0aROKW302Z6ypNDO.FGNElSU4UUbnT5XUZcKqWWdMekbkfm';

/* Filters arrive as [[column, op, value], …]. Declared up here, not beside
   build_where(): a top-level `const` runs when execution reaches it, and
   execution never gets past the dispatch block below. */
const OPS = ['eq' => '=', 'neq' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<=', 'like' => 'LIKE'];

start_session();

$action = (string)($_GET['action'] ?? '');

/* ---------- request guards ---------- */
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    // Deliberately no CORS headers: this API is same-origin only.
    fail(405, 'Not allowed.');
}
if (($_SERVER['HTTP_X_GMC_REQUEST'] ?? '') !== '1') {
    fail(403, 'Missing request header. Reload the page and try again.');
}

$raw  = file_get_contents('php://input') ?: '';
$body = $raw === '' ? [] : json_decode($raw, true);
if (!is_array($body)) $body = [];

try {
    switch ($action) {
        case 'login':        do_login($body);        break;
        case 'google_login': do_google_login($body); break;
        case 'logout':  do_logout();       break;
        case 'session': do_session();      break;
        case 'select':  do_select($body);  break;
        case 'insert':  do_insert($body);  break;
        case 'update':  do_update($body);  break;
        case 'delete':  do_delete($body);  break;
        default:        fail(404, 'Unknown action.');
    }
} catch (PDOException $e) {
    error_log('[gmc-api] ' . $e->getMessage());
    // The driver's message can name columns and paths; keep it in the log.
    fail(500, 'Database error. Check the server error log for details.');
} catch (Throwable $e) {
    error_log('[gmc-api] ' . $e->getMessage());
    fail(500, 'Server error. Check the server error log for details.');
}

/* =====================================================
   Auth
   ===================================================== */
function current_user(): ?array {
    return isset($_SESSION['uid']) ? [
        'id'    => $_SESSION['uid'],
        'email' => $_SESSION['uemail'] ?? '',
        'name'  => $_SESSION['uname'] ?? '',
        'is_admin' => !empty($_SESSION['uadmin']),
    ] : null;
}

function require_user(): array {
    $u = current_user();
    if (!$u) fail(401, 'Not signed in.');
    return $u;
}

function do_login(array $b): void {
    $cfg = config() ?? [];
    if (isset($cfg['allow_password_login']) && !$cfg['allow_password_login']) {
        fail(403, 'Password sign-in is turned off here. Use Sign in with Google.');
    }

    $email = strtolower(trim((string)($b['email'] ?? '')));
    $pass  = (string)($b['password'] ?? '');
    if ($email === '' || $pass === '') fail(400, 'Enter your email and password.');

    $pdo = db();
    $ip  = client_ip();
    prune_attempts($pdo);

    $since = gmdate('Y-m-d H:i:s', time() - LOGIN_WINDOW_MIN * 60);

    // Per IP, and — the part that matters — per account. Throttling by IP
    // alone leaves one address open to unlimited guessing from a rotating
    // set of addresses, which is how this would actually be attacked.
    $st = $pdo->prepare('SELECT COUNT(*) FROM `login_attempts` WHERE `ip` = ? AND `at` > ?');
    $st->execute([$ip, $since]);
    $byIp = (int)$st->fetchColumn();

    $st = $pdo->prepare('SELECT COUNT(*) FROM `login_attempts` WHERE `email` = ? AND `at` > ?');
    $st->execute([$email, $since]);
    $byAccount = (int)$st->fetchColumn();

    if ($byIp >= LOGIN_MAX_TRIES || $byAccount >= LOGIN_MAX_ACCOUNT) {
        note_attempt($pdo, $ip, $email);     // keep the window sliding while they hammer
        fail(429, 'Too many sign-in attempts. Wait ' . LOGIN_WINDOW_MIN . ' minutes and try again.');
    }

    $st = $pdo->prepare('SELECT * FROM `users` WHERE `email` = ? LIMIT 1');
    $st->execute([$email]);
    $user = $st->fetch();

    // Always do the bcrypt work, even with no such user and even for a
    // Google-only account, so every failure takes the same time.
    $hash = ($user && $user['password_hash'] !== null && $user['password_hash'] !== '')
        ? (string)$user['password_hash']
        : DUMMY_HASH;
    $passwordOk = password_verify($pass, $hash);

    $ok = $user
        && (int)$user['is_active'] === 1
        && $user['password_hash'] !== null && $user['password_hash'] !== ''
        && $passwordOk;

    if (!$ok) {
        note_attempt($pdo, $ip, $email);
        // Each successive failure costs a little more wall-clock time.
        usleep(min(1500000, 150000 * (1 + max($byIp, $byAccount))));
        fail(401, 'Email or password is incorrect.');
    }

    if (password_needs_rehash((string)$user['password_hash'], PASSWORD_DEFAULT)) {
        $pdo->prepare('UPDATE `users` SET `password_hash` = ? WHERE `id` = ?')
            ->execute([password_hash($pass, PASSWORD_DEFAULT), $user['id']]);
    }

    $pdo->prepare('DELETE FROM `login_attempts` WHERE `ip` = ? OR `email` = ?')->execute([$ip, $email]);
    establish_session($user);
}

function note_attempt(PDO $pdo, string $ip, string $email): void {
    $pdo->prepare('INSERT INTO `login_attempts` (`ip`, `email`) VALUES (?, ?)')->execute([$ip, $email]);
}

/* The table only needs the current window; without this it grows forever. */
function prune_attempts(PDO $pdo): void {
    if (random_int(1, 20) !== 1) return;
    $pdo->prepare('DELETE FROM `login_attempts` WHERE `at` < ?')
        ->execute([gmdate('Y-m-d H:i:s', time() - 86400)]);
}

function establish_session(array $user): void {
    db()->prepare('UPDATE `users` SET `last_login_at` = UTC_TIMESTAMP() WHERE `id` = ?')->execute([$user['id']]);

    // New session id on privilege change, so a fixated one is worthless.
    session_regenerate_id(true);
    $_SESSION['uid']     = $user['id'];
    $_SESSION['uemail']  = $user['email'];
    $_SESSION['uname']   = ($user['name'] ?? '') !== '' ? $user['name'] : explode('@', (string)$user['email'])[0];
    $_SESSION['uadmin']  = (int)($user['is_admin'] ?? 0) === 1;

    json_out(['data' => ['user' => current_user()]]);
}

/* Sign in with Google. Google has already proved who this is; all that is
   left is to check the address is one we allow in. */
function do_google_login(array $b): void {
    $cfg      = config() ?? [];
    $clientId = trim((string)($cfg['google_client_id'] ?? ''));
    if ($clientId === '') fail(400, 'Google sign-in is not configured. Add google_client_id to api/config.php.');

    $credential = (string)($b['credential'] ?? '');
    if ($credential === '') fail(400, 'No Google credential supplied.');

    try {
        $claims = google_verify_id_token($credential, $clientId);
    } catch (Throwable $e) {
        error_log('[gmc-api] google token rejected: ' . $e->getMessage());
        fail(401, 'Google sign-in could not be verified. Try again.');
    }

    $email = strtolower(trim((string)$claims['email']));

    $st = db()->prepare('SELECT * FROM `users` WHERE `email` = ? LIMIT 1');
    $st->execute([$email]);
    $user = $st->fetch();

    // A valid Google account is not a free pass — the address has to be listed.
    if (!$user) {
        fail(403, 'There is no account here for ' . $email . '. An admin can add it on the Users page.');
    }
    if ((int)$user['is_active'] !== 1) {
        fail(403, 'That account has been deactivated.');
    }

    // Remember the Google subject id the first time; it survives an email change.
    if (array_key_exists('google_sub', $user) && empty($user['google_sub']) && !empty($claims['sub'])) {
        try {
            db()->prepare('UPDATE `users` SET `google_sub` = ? WHERE `id` = ?')
                ->execute([(string)$claims['sub'], $user['id']]);
        } catch (Throwable $e) { /* column may predate the upgrade; not worth failing a login over */ }
    }

    establish_session($user);
}

function do_logout(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
    json_out(['data' => ['user' => null]]);
}

function do_session(): void {
    json_out(['data' => ['user' => current_user()]]);
}

/* =====================================================
   Query building
   ===================================================== */
function need_table(array $b): string {
    $t = (string)($b['table'] ?? '');
    if (!table_exists_in_schema($t)) fail(400, 'Unknown table.');
    return $t;
}

function build_where(string $table, $filters, array &$params): string {
    if (!is_array($filters) || !$filters) return '';
    $parts = [];
    foreach ($filters as $f) {
        if (!is_array($f) || count($f) < 3) fail(400, 'Malformed filter.');
        [$col, $op, $val] = [(string)$f[0], (string)$f[1], $f[2]];
        if (!column_allowed($table, $col)) fail(400, "Unknown column '{$col}'.");

        if ($op === 'is') {                       // .is(col, null)
            if ($val !== null) fail(400, "Only NULL is supported with 'is'.");
            $parts[] = "`{$col}` IS NULL";
            continue;
        }
        if ($op === 'in') {
            if (!is_array($val) || !$val) fail(400, "'in' needs a non-empty list.");
            $marks = [];
            foreach ($val as $v) { $marks[] = '?'; $params[] = coerce($v, column_type($table, $col)); }
            $parts[] = "`{$col}` IN (" . implode(',', $marks) . ')';
            continue;
        }
        if (!isset(OPS[$op])) fail(400, "Unsupported operator '{$op}'.");

        $params[] = coerce($val, column_type($table, $col));
        $parts[]  = "`{$col}` " . OPS[$op] . ' ?';
    }
    return $parts ? ' WHERE ' . implode(' AND ', $parts) : '';
}

function do_select(array $b): void {
    require_user();
    $table = need_table($b);

    // columns: '*' or a comma-separated list, each checked against the whitelist
    $colsIn = trim((string)($b['columns'] ?? '*'));
    if ($colsIn === '' || $colsIn === '*') {
        $select = '*';
    } else {
        $list = [];
        foreach (explode(',', $colsIn) as $c) {
            $c = trim($c);
            if ($c === '') continue;
            if (!column_allowed($table, $c)) fail(400, "Unknown column '{$c}'.");
            $list[] = "`{$c}`";
        }
        $select = $list ? implode(', ', $list) : '*';
    }

    $params = [];
    $sql = "SELECT {$select} FROM `{$table}`" . build_where($table, $b['filters'] ?? [], $params);

    if (!empty($b['order']) && is_array($b['order'])) {
        $oc = (string)($b['order']['column'] ?? '');
        if (!column_allowed($table, $oc)) fail(400, "Cannot sort by '{$oc}'.");
        $dir = (($b['order']['ascending'] ?? true)) ? 'ASC' : 'DESC';
        $sql .= " ORDER BY `{$oc}` {$dir}";
    }

    // range is inclusive on both ends, matching what the pages already expect
    $limit = MAX_ROWS; $offset = 0;
    if (!empty($b['range']) && is_array($b['range']) && count($b['range']) === 2) {
        $from = max(0, (int)$b['range'][0]);
        $to   = max($from, (int)$b['range'][1]);
        $offset = $from;
        $limit  = min(MAX_ROWS, $to - $from + 1);
    } elseif (isset($b['limit'])) {
        $limit = max(1, min(MAX_ROWS, (int)$b['limit']));
    }
    $sql .= " LIMIT {$limit} OFFSET {$offset}";   // both already cast to int

    $st = db()->prepare($sql);
    $st->execute($params);
    $rows = array_map(static fn(array $r): array => cast_row($r, $table), $st->fetchAll());

    json_out(['data' => $rows]);
}

function do_insert(array $b): void {
    $u     = require_user();
    $table = need_table($b);

    $rows = $b['rows'] ?? null;
    if (!is_array($rows) || !$rows) fail(400, 'Nothing to insert.');
    if (!array_is_list($rows)) $rows = [$rows];   // a bare object means one row
    if (count($rows) > 2000) fail(400, 'Too many rows in one insert. Split the batch.');

    $pdo = db();
    $ids = [];

    $pdo->beginTransaction();
    try {
        foreach ($rows as $row) {
            if (!is_array($row)) fail(400, 'Malformed row.');

            $data = [];
            foreach ($row as $col => $val) {
                $col = (string)$col;
                if (!column_writable($table, $col)) continue;   // silently drop unknown keys
                $data[$col] = coerce($val, column_type($table, $col));
            }
            if (!isset($data['id']) || $data['id'] === null) $data['id'] = uuid4();
            $ids[] = $data['id'];

            $cols  = array_keys($data);
            $marks = implode(',', array_fill(0, count($cols), '?'));
            $names = implode(',', array_map(static fn($c) => "`{$c}`", $cols));

            $st = $pdo->prepare("INSERT INTO `{$table}` ({$names}) VALUES ({$marks})");
            $st->execute(array_values($data));
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    json_out(['data' => ['ids' => $ids, 'count' => count($ids)]]);
}

function do_update(array $b): void {
    require_user();
    $table = need_table($b);

    $patch = $b['patch'] ?? null;
    if (!is_array($patch) || !$patch) fail(400, 'Nothing to update.');

    $params = [];
    $sets   = [];
    foreach ($patch as $col => $val) {
        $col = (string)$col;
        if ($col === 'id') continue;                    // never move a row's identity
        if (!column_writable($table, $col)) continue;
        $sets[]   = "`{$col}` = ?";
        $params[] = coerce($val, column_type($table, $col));
    }
    if (!$sets) fail(400, 'No writable columns in that update.');

    // An unfiltered UPDATE would rewrite the whole table.
    $filters = $b['filters'] ?? [];
    if (!is_array($filters) || !$filters) fail(400, 'Refusing to update every row — add a filter.');

    $where = build_where($table, $filters, $params);
    $st = db()->prepare("UPDATE `{$table}` SET " . implode(', ', $sets) . $where);
    $st->execute($params);

    json_out(['data' => ['count' => $st->rowCount()]]);
}

function do_delete(array $b): void {
    require_user();
    $table = need_table($b);

    $filters = $b['filters'] ?? [];
    if (!is_array($filters) || !$filters) fail(400, 'Refusing to delete every row — add a filter.');

    $params = [];
    $where  = build_where($table, $filters, $params);
    $st = db()->prepare("DELETE FROM `{$table}`{$where}");
    $st->execute($params);

    json_out(['data' => ['count' => $st->rowCount()]]);
}
