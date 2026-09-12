<?php
/* ============================================================
   Giant Motor Cars CRM — V2 setup wizard

   Three steps: database credentials, create tables, create the
   first sign-in. Locks itself once a user exists, and tells you
   to delete it when it's done.

   Everything it does can also be done by hand — edit
   api/config.php, run schema.sql in phpMyAdmin — this just
   saves the trip.
   ============================================================ */

declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

$step    = (string)($_GET['step'] ?? '');
$notice  = '';
$problem = '';

function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

/* Has anyone signed up yet? If so this wizard is closed for business. */
function has_users(): bool {
    try {
        $n = (int)db()->query('SELECT COUNT(*) FROM `users`')->fetchColumn();
        return $n > 0;
    } catch (Throwable $e) { return false; }
}

function tables_present(): bool {
    try {
        db()->query('SELECT 1 FROM `sold_customers` LIMIT 1');
        return true;
    } catch (Throwable $e) { return false; }
}

$configured = config() !== null;
$locked     = $configured && has_users();

/* ---------- step 1: write api/config.php ---------- */
if ($step === 'db' && $_SERVER['REQUEST_METHOD'] === 'POST' && !$locked) {
    $host = trim((string)($_POST['db_host'] ?? 'localhost'));
    $port = trim((string)($_POST['db_port'] ?? '3306'));
    $name = trim((string)($_POST['db_name'] ?? ''));
    $user = trim((string)($_POST['db_user'] ?? ''));
    $pass = (string)($_POST['db_pass'] ?? '');

    try {
        db_connect($host, $name, $user, $pass, $port);   // prove it works before saving
        $php = "<?php\n/* Written by setup.php. Keep this file out of version control. */\nreturn "
             . var_export([
                 'db_host' => $host, 'db_port' => $port, 'db_name' => $name,
                 'db_user' => $user, 'db_pass' => $pass,
               ], true) . ";\n";

        if (@file_put_contents(CONFIG_PATH, $php) === false) {
            $problem = 'Could not write api/config.php. Create it by hand from api/config.example.php, '
                     . 'or make the api/ folder writable (chmod 755) and try again.';
        } else {
            @chmod(CONFIG_PATH, 0600);
            header('Location: setup.php?step=tables'); exit;
        }
    } catch (PDOException $e) {
        $problem = 'Could not connect: ' . $e->getMessage();
    }
}

/* ---------- step 2: create the tables ---------- */
if ($step === 'tables' && $_SERVER['REQUEST_METHOD'] === 'POST' && !$locked) {
    try {
        $sql = (string)file_get_contents(__DIR__ . '/schema.sql');
        $pdo = db();
        // Strip comment lines BEFORE splitting. Splitting first leaves each
        // statement carrying the comment block above it, and skipping chunks
        // that start with '--' then silently drops those tables.
        $sql = preg_replace('/^[ \t]*--.*$/m', '', $sql) ?? $sql;
        $made = 0;
        foreach (preg_split('/;\s*(?:\n|$)/', $sql) as $stmt) {
            $stmt = trim($stmt);
            if ($stmt === '') continue;
            $pdo->exec($stmt);
            $made++;
        }
        if ($made < 7) throw new RuntimeException("Only {$made} of 7 statements ran. Import schema.sql by hand in phpMyAdmin.");
        header('Location: setup.php?step=user'); exit;
    } catch (Throwable $e) {
        $problem = 'Could not create the tables: ' . $e->getMessage();
    }
}

/* ---------- step 3: first user ---------- */
if ($step === 'user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($locked) {
        $problem = 'An account already exists. Delete setup.php.';
    } else {
        $email = strtolower(trim((string)($_POST['email'] ?? '')));
        $name  = trim((string)($_POST['name'] ?? ''));
        $pw    = (string)($_POST['password'] ?? '');
        $pw2   = (string)($_POST['password2'] ?? '');

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $problem = 'That email address does not look valid.';
        elseif (strlen($pw) < 10)                       $problem = 'Use a password of at least 10 characters.';
        elseif ($pw !== $pw2)                           $problem = 'The two passwords do not match.';
        else {
            try {
                db()->prepare('INSERT INTO `users` (`id`,`email`,`name`,`password_hash`) VALUES (?,?,?,?)')
                    ->execute([uuid4(), $email, $name, password_hash($pw, PASSWORD_DEFAULT)]);
                header('Location: setup.php?step=done'); exit;
            } catch (Throwable $e) {
                $problem = 'Could not create the account: ' . $e->getMessage();
            }
        }
    }
}

/* Work out which step to show if none was asked for. */
if ($step === '' || ($step === 'db' && $_SERVER['REQUEST_METHOD'] !== 'POST' && $configured)) {
    if (!$configured)            $step = 'db';
    elseif (!tables_present())   $step = 'tables';
    elseif (!has_users())        $step = 'user';
    else                         $step = 'done';
}
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Giant Motor Cars CRM — Setup</title>
<style>
:root{--ink:#0F1115;--muted:#6B7280;--line:#E4E7EC;--primary:#047857;--primary-ink:#065F46;--paper:#F4F5F7}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;
  display:grid;place-items:center;min-height:100vh;padding:24px}
.box{background:#fff;border:1px solid var(--line);border-radius:16px;padding:30px;width:100%;max-width:520px;
  box-shadow:0 12px 40px rgba(16,17,21,.10)}
h1{font-size:20px;margin:0 0 4px}
.sub{color:var(--muted);font-size:13.5px;margin-bottom:22px}
.steps{display:flex;gap:6px;margin-bottom:22px}
.steps div{flex:1;height:4px;border-radius:4px;background:var(--line)}
.steps div.on{background:var(--primary)}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;
  letter-spacing:.03em;margin:14px 0 5px}
input{width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:9px;font-size:14px;outline:none}
input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(4,120,87,.12)}
button{margin-top:22px;width:100%;height:42px;background:var(--primary);color:#fff;border:none;border-radius:10px;
  font-weight:600;font-size:15px;cursor:pointer}
button:hover{background:var(--primary-ink)}
.err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:11px 13px;border-radius:9px;
  font-size:13.5px;margin-bottom:16px;word-break:break-word}
.ok{background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;padding:11px 13px;border-radius:9px;
  font-size:13.5px;margin-bottom:16px}
.hint{font-size:12.5px;color:var(--muted);margin-top:7px;line-height:1.5}
.row{display:grid;grid-template-columns:2fr 1fr;gap:10px}
code{background:#EDEFF3;padding:2px 6px;border-radius:5px;font-size:12.5px}
a.btn{display:block;text-align:center;margin-top:18px;color:var(--primary);font-weight:600;text-decoration:none}
</style>
</head>
<body>
<div class="box">
  <h1>Giant Motor Cars CRM</h1>
  <div class="sub">V2 setup — database and first sign-in</div>
  <div class="steps">
    <div class="<?= in_array($step,['db','tables','user','done'],true)?'on':'' ?>"></div>
    <div class="<?= in_array($step,['tables','user','done'],true)?'on':'' ?>"></div>
    <div class="<?= in_array($step,['user','done'],true)?'on':'' ?>"></div>
  </div>

  <?php if ($problem): ?><div class="err"><?= h($problem) ?></div><?php endif; ?>
  <?php if ($notice):  ?><div class="ok"><?= h($notice)  ?></div><?php endif; ?>

  <?php if ($locked && $step !== 'done'): ?>
    <div class="err">Setup is already complete — an account exists. Delete <code>setup.php</code> from the server.</div>
    <a class="btn" href="index.html">Go to the CRM →</a>

  <?php elseif ($step === 'db'): ?>
    <form method="post" action="setup.php?step=db">
      <p style="margin:0;font-size:14px">Create a MySQL database and user in cPanel first
        (<b>MySQL&nbsp;Databases</b> → create database, create user, then <b>Add User To Database</b>
        with <b>All Privileges</b>), then enter them here.</p>
      <label>Database host</label>
      <div class="row">
        <input name="db_host" value="localhost" required>
        <input name="db_port" value="3306" required>
      </div>
      <div class="hint">On cPanel this is almost always <code>localhost</code>.</div>
      <label>Database name</label>
      <input name="db_name" placeholder="cpaneluser_gmccrm" required>
      <label>Database user</label>
      <input name="db_user" placeholder="cpaneluser_gmc" required>
      <label>Database password</label>
      <input name="db_pass" type="password" required>
      <button type="submit">Test and continue</button>
    </form>

  <?php elseif ($step === 'tables'): ?>
    <form method="post" action="setup.php?step=tables">
      <div class="ok">Connected to the database.</div>
      <p style="margin:0;font-size:14px">Now create the seven tables the CRM needs. This is safe to run
        on a database that already has them — nothing is dropped or overwritten.</p>
      <button type="submit">Create tables</button>
    </form>

  <?php elseif ($step === 'user'): ?>
    <form method="post" action="setup.php?step=user">
      <div class="ok">Tables are ready.</div>
      <p style="margin:0;font-size:14px">Create the first sign-in. You can add more people later
        straight in the <code>users</code> table.</p>
      <label>Your name</label>
      <input name="name" placeholder="Rami Saleh" value="<?= h($_POST['name'] ?? '') ?>">
      <label>Email</label>
      <input name="email" type="email" placeholder="you@giantmotorcars.com" value="<?= h($_POST['email'] ?? '') ?>" required>
      <label>Password</label>
      <input name="password" type="password" required>
      <div class="hint">At least 10 characters. Stored hashed — it can't be read back out.</div>
      <label>Password again</label>
      <input name="password2" type="password" required>
      <button type="submit">Create account</button>
    </form>

  <?php else: ?>
    <div class="ok">Setup complete.</div>
    <p style="margin:0;font-size:14px"><b>Delete <code>setup.php</code> from the server now.</b>
      It refuses to run again, but there's no reason to leave it there.</p>
    <a class="btn" href="index.html">Go to the CRM →</a>
  <?php endif; ?>
</div>
</body>
</html>
