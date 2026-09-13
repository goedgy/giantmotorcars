<?php
/* ============================================================
   Giant Motor Cars CRM — V2 shared bootstrap
   Config, database handle, session, and the small helpers the
   API and setup wizard both need.
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/schema.php';

/* PHP 8.1 added this; shared hosts often still offer 8.0. Must be
   declared before any code path can reach it — a conditional
   declaration isn't hoisted the way a plain one is. */
if (!function_exists('array_is_list')) {
    function array_is_list(array $a): bool {
        return $a === [] || array_keys($a) === range(0, count($a) - 1);
    }
}

/* Never render a PHP warning into a JSON response — it corrupts the
   body and can leak paths. Errors are logged and reported as JSON. */
ini_set('display_errors', '0');
error_reporting(E_ALL);

const CONFIG_PATH = __DIR__ . '/config.php';

function config(): ?array {
    static $cfg = null;
    if ($cfg === null) {
        if (!is_file(CONFIG_PATH)) return null;
        $loaded = @require CONFIG_PATH;
        // A partially written file can parse to something that isn't our
        // config at all; treat anything unrecognisable as absent.
        $cfg = (is_array($loaded) && array_key_exists('db_name', $loaded)) ? $loaded : null;
    }
    return $cfg;
}

/* Writing config.php in place leaves a window where a concurrent request
   reads a half-written file — and on a host with opcache the old version
   keeps being served afterwards. Write to a temp file and rename (atomic on
   POSIX), then drop the cached copies. */
function write_config(array $cfg): bool {
    $php = "<?php\n/* Written by setup.php / upgrade.php. Keep this file out of version control. */\nreturn "
         . var_export($cfg, true) . ";\n";

    $tmp = CONFIG_PATH . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $php, LOCK_EX) === false) return false;
    @chmod($tmp, 0600);
    if (!@rename($tmp, CONFIG_PATH)) { @unlink($tmp); return false; }

    clearstatcache(true, CONFIG_PATH);
    if (function_exists('opcache_invalidate')) @opcache_invalidate(CONFIG_PATH, true);
    return true;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $c = config();
    if (!$c) fail(500, 'The API is not configured yet. Run setup.php.');

    $pdo = db_connect(
        (string)($c['db_host'] ?? 'localhost'),
        (string)($c['db_name'] ?? ''),
        (string)($c['db_user'] ?? ''),
        (string)($c['db_pass'] ?? ''),
        (string)($c['db_port'] ?? '3306')
    );
    return $pdo;
}

/* Separate from db() so setup.php can test credentials before writing them. */
function db_connect(string $host, string $name, string $user, string $pass, string $port = '3306'): PDO {
    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
    return new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        // Real prepared statements, so values can never be parsed as SQL.
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
}

function is_https(): bool {
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') return true;
    // cPanel sits behind a proxy that terminates TLS upstream.
    if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') return true;
    return ((int)($_SERVER['SERVER_PORT'] ?? 0)) === 443;
}

function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,   // JavaScript can't read it, so XSS can't steal it
        'samesite' => 'Strict', // and it never rides along on a cross-site request
    ]);
    session_name('GMCSESS');
    session_start();
}

function json_out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    header('Referrer-Policy: same-origin');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $code, string $message): void {
    json_out(['error' => $message], $code);
}

function uuid4(): string {
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

function client_ip(): string {
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

/* ---------- value coercion ----------
   The browser sends JSON; MySQL wants its own shapes. Anything empty
   becomes NULL rather than '' so DATE and DECIMAL columns don't blow
   up under strict mode. */
function coerce($value, string $type) {
    if ($value === null) return null;
    if (is_bool($value)) $value = $value ? 1 : 0;

    switch ($type) {
        case 'bool':
            if ($value === '' ) return 0;
            if (is_string($value)) return in_array(strtolower($value), ['1','true','yes','y','t'], true) ? 1 : 0;
            return $value ? 1 : 0;

        case 'int':
            if ($value === '' || $value === null) return null;
            if (!is_numeric($value)) {
                $digits = preg_replace('/[^0-9\-]/', '', (string)$value);
                return ($digits === '' || $digits === '-') ? null : (int)$digits;
            }
            return (int)$value;

        case 'dec':
            if ($value === '' || $value === null) return null;
            if (!is_numeric($value)) {
                // Accept "$1,204.50" and the "(50.00)" negative form Frazer uses.
                $s   = trim((string)$value);
                $neg = (bool)preg_match('/^\(.*\)$/', $s);
                $s   = preg_replace('/[^0-9.\-]/', '', $s);
                if ($s === '' || $s === '-' || $s === '.') return null;
                $n = (float)$s;
                return $neg ? -$n : $n;
            }
            return (float)$value;

        case 'date':
            $s = trim((string)$value);
            if ($s === '') return null;
            if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $s, $m)) return $m[1];
            $t = strtotime($s);
            return $t === false ? null : gmdate('Y-m-d', $t);

        case 'datetime':
            $s = trim((string)$value);
            if ($s === '') return null;
            $t = strtotime($s);
            return $t === false ? null : gmdate('Y-m-d H:i:s', $t);

        case 'uuid':
        case 'str':
        case 'text':
        default:
            if (is_array($value) || is_object($value)) return json_encode($value);
            $s = (string)$value;
            return $s === '' ? null : $s;
    }
}

/* MySQL hands back everything as strings. The front end compares
   numbers and checks booleans, so convert on the way out. */
function cast_row(array $row, string $table): array {
    foreach ($row as $col => $val) {
        if ($val === null || !column_allowed($table, (string)$col)) continue;
        switch (column_type($table, (string)$col)) {
            case 'bool': $row[$col] = ((int)$val) === 1; break;
            case 'int':  $row[$col] = (int)$val;         break;
            case 'dec':  $row[$col] = (float)$val;       break;
        }
    }
    return $row;
}
