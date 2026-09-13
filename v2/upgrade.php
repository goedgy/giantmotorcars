<?php
/* ============================================================
   Giant Motor Cars CRM — V2 upgrade

   Brings an install created by an earlier setup.php up to date:
   the columns Google sign-in needs, and the client id itself.

   Safe to run more than once — every step checks first and skips
   what is already done. Delete this file when you're finished.
   ============================================================ */

declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

start_session();
$signedIn = isset($_SESSION['uid']);

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

function has_column(string $table, string $col): bool {
    $st = db()->prepare(
        'SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
    );
    $st->execute([$table, $col]);
    return (int)$st->fetchColumn() > 0;
}

function column_is_nullable(string $table, string $col): bool {
    $st = db()->prepare(
        'SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
    );
    $st->execute([$table, $col]);
    return strtoupper((string)$st->fetchColumn()) === 'YES';
}

$done = []; $problem = ''; $saved = false;

if ($signedIn && $_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $pdo = db();

        // 1. a Google-only user has no password at all
        if (!column_is_nullable('users', 'password_hash')) {
            $pdo->exec('ALTER TABLE `users` MODIFY `password_hash` VARCHAR(255) NULL DEFAULT NULL');
            $done[] = 'Passwords are now optional on an account.';
        }
        if (!has_column('users', 'google_sub')) {
            $pdo->exec('ALTER TABLE `users` ADD `google_sub` VARCHAR(64) NULL DEFAULT NULL AFTER `password_hash`');
            $done[] = 'Added google_sub.';
        }
        if (!has_column('users', 'is_admin')) {
            $pdo->exec('ALTER TABLE `users` ADD `is_admin` TINYINT(1) NOT NULL DEFAULT 0 AFTER `google_sub`');
            // Everyone who already had an account predates the distinction —
            // making them admins avoids locking you out of your own Users page.
            $pdo->exec('UPDATE `users` SET `is_admin` = 1');
            $done[] = 'Added admin rights and granted them to existing accounts.';
        }

        // 2. fold the Google client id into api/config.php
        $clientId = trim((string)($_POST['google_client_id'] ?? ''));
        $allowPw  = isset($_POST['allow_password_login']);
        $cfg = config() ?? [];
        $cfg['google_client_id']     = $clientId;
        $cfg['allow_password_login'] = $allowPw;

        if (!write_config($cfg)) {
            $problem = 'Database is updated, but api/config.php could not be written. Edit it by hand and add '
                     . "'google_client_id' => '…'.";
        } else {
            $saved = true;
            $done[] = $clientId !== '' ? 'Saved the Google client id.' : 'Cleared the Google client id.';
            $done[] = $allowPw ? 'Password sign-in stays enabled.' : 'Password sign-in is now turned off.';
        }

        // refresh the session's admin flag so the Users page opens straight away
        $st = $pdo->prepare('SELECT `is_admin` FROM `users` WHERE `id` = ?');
        $st->execute([$_SESSION['uid']]);
        $_SESSION['uadmin'] = ((int)$st->fetchColumn() === 1);
    } catch (Throwable $e) {
        $problem = $e->getMessage();
    }
}

$cfgNow    = config() ?? [];
$currentId = (string)($cfgNow['google_client_id'] ?? '');
$allowNow  = !isset($cfgNow['allow_password_login']) || (bool)$cfgNow['allow_password_login'];
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Upgrade — Giant Motor Cars CRM</title>
<style>
:root{--ink:#0F1115;--muted:#6B7280;--line:#E4E7EC;--primary:#047857;--primary-ink:#065F46;--paper:#F4F5F7}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;
  display:grid;place-items:start center;min-height:100vh;padding:36px 20px}
.box{background:#fff;border:1px solid var(--line);border-radius:16px;padding:30px;width:100%;max-width:620px;
  box-shadow:0 12px 40px rgba(16,17,21,.10)}
h1{font-size:20px;margin:0 0 4px}
.sub{color:var(--muted);font-size:13.5px;margin-bottom:22px}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin:16px 0 5px}
input[type=text]{width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:9px;font-size:13px;outline:none;font-family:ui-monospace,monospace}
input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(4,120,87,.12)}
button{margin-top:22px;width:100%;height:42px;background:var(--primary);color:#fff;border:none;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer}
button:hover{background:var(--primary-ink)}
.err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:11px 13px;border-radius:9px;font-size:13.5px;margin-bottom:16px}
.ok{background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;padding:11px 13px;border-radius:9px;font-size:13.5px;margin-bottom:16px}
.warn{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;padding:11px 13px;border-radius:9px;font-size:13px;margin:14px 0}
.chk{display:flex;gap:9px;align-items:flex-start;margin-top:16px;font-size:14px;cursor:pointer}
.chk input{width:17px;height:17px;margin-top:2px;accent-color:var(--primary);flex:none}
.hint{font-size:12.5px;color:var(--muted);margin-top:6px;line-height:1.5}
code{background:#EDEFF3;padding:2px 6px;border-radius:5px;font-size:12.5px;word-break:break-all}
a{color:var(--primary);font-weight:600}
ul{margin:6px 0 0;padding-left:20px;font-size:14px}
</style>
</head>
<body>
<div class="box">
  <h1>Upgrade</h1>
  <div class="sub">Adds what Google sign-in needs. Safe to run twice.</div>

  <?php if (!$signedIn): ?>
    <div class="err">Sign in to the CRM first, then reload this page.</div>
    <a href="index.html">Go to the CRM →</a>

  <?php else: ?>
    <?php if ($problem): ?><div class="err"><?= h($problem) ?></div><?php endif; ?>
    <?php if ($done): ?>
      <div class="ok"><b>Done.</b><ul><?php foreach ($done as $d): ?><li><?= h($d) ?></li><?php endforeach; ?></ul></div>
      <?php if ($saved): ?>
        <p style="font-size:14px">Now open <a href="users.php">Users</a> to add the people who should be able to
          sign in, then sign out and try the Google button. <b>Delete this file when you're done.</b></p>
      <?php endif; ?>
    <?php endif; ?>

    <form method="post">
      <label>Google OAuth client ID</label>
      <input type="text" name="google_client_id" value="<?= h($currentId) ?>"
             placeholder="1234567890-abc123.apps.googleusercontent.com">
      <div class="hint">The same one already in the config block of <code>index.html</code>. Google Cloud →
        APIs &amp; Services → Credentials.</div>

      <label class="chk">
        <input type="checkbox" name="allow_password_login" <?= $allowNow ? 'checked' : '' ?>>
        <span>Keep accepting email + password sign-in
          <div class="hint">Leave this ticked until Google sign-in works for everyone. Once it does, come back
            and untick it — with no password accepted anywhere, there is nothing left to brute force.</div>
        </span>
      </label>

      <div class="warn">Unticking this while nobody can sign in with Google would lock you out. Test the Google
        button first, in a private window.</div>

      <button type="submit">Apply</button>
    </form>
  <?php endif; ?>
</div>
</body>
</html>
