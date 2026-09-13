<?php
/* ============================================================
   Giant Motor Cars CRM — V2 users

   Who is allowed to sign in. With Google sign-in that is the whole
   security model: Google proves who someone is, this list decides
   whether they get in. Adding someone is just adding their address.

   Admin only. Guards against the two ways a small team locks
   itself out: removing your own admin rights, and removing the
   last admin.
   ============================================================ */

declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

start_session();
$me = $_SESSION['uid'] ?? null;
if (!$me) { $state = 'anon'; }
else {
    $st = db()->prepare('SELECT * FROM `users` WHERE `id` = ? LIMIT 1');
    $st->execute([$me]);
    $meRow = $st->fetch() ?: null;
    // is_admin may not exist yet on an install that hasn't run upgrade.php
    $isAdmin = $meRow && (!array_key_exists('is_admin', $meRow) || (int)$meRow['is_admin'] === 1);
    $state = $isAdmin ? 'ok' : 'forbidden';
}

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

function admin_count(): int {
    try { return (int)db()->query('SELECT COUNT(*) FROM `users` WHERE `is_admin` = 1 AND `is_active` = 1')->fetchColumn(); }
    catch (Throwable $e) { return 1; }
}

$notice = ''; $problem = '';

if (($state ?? '') === 'ok' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $do = (string)($_POST['do'] ?? '');
    $id = (string)($_POST['id'] ?? '');
    try {
        $pdo = db();

        if ($do === 'add') {
            $email = strtolower(trim((string)($_POST['email'] ?? '')));
            $name  = trim((string)($_POST['name'] ?? ''));
            $pw    = (string)($_POST['password'] ?? '');
            $admin = isset($_POST['is_admin']) ? 1 : 0;

            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('That email address does not look valid.');
            if ($pw !== '' && strlen($pw) < 10)             throw new RuntimeException('A password needs at least 10 characters. Leave it blank for Google-only sign-in.');

            $st = $pdo->prepare('SELECT COUNT(*) FROM `users` WHERE `email` = ?');
            $st->execute([$email]);
            if ((int)$st->fetchColumn() > 0) throw new RuntimeException('There is already an account for ' . $email . '.');

            $pdo->prepare('INSERT INTO `users` (`id`,`email`,`name`,`password_hash`,`is_admin`) VALUES (?,?,?,?,?)')
                ->execute([uuid4(), $email, $name, $pw === '' ? null : password_hash($pw, PASSWORD_DEFAULT), $admin]);
            $notice = $pw === ''
                ? $email . ' can now sign in with Google.'
                : $email . ' can now sign in with Google or with that password.';
        }

        elseif ($do === 'toggle_active') {
            if ($id === $me) throw new RuntimeException('You cannot deactivate your own account.');
            $st = $pdo->prepare('SELECT * FROM `users` WHERE `id` = ?'); $st->execute([$id]);
            $u = $st->fetch(); if (!$u) throw new RuntimeException('No such account.');
            $next = (int)$u['is_active'] === 1 ? 0 : 1;
            if ($next === 0 && (int)($u['is_admin'] ?? 0) === 1 && admin_count() <= 1) {
                throw new RuntimeException('That is the last active admin — promote someone else first.');
            }
            $pdo->prepare('UPDATE `users` SET `is_active` = ? WHERE `id` = ?')->execute([$next, $id]);
            $notice = $u['email'] . ($next ? ' can sign in again.' : ' can no longer sign in.');
        }

        elseif ($do === 'toggle_admin') {
            if ($id === $me) throw new RuntimeException('You cannot change your own admin rights.');
            $st = $pdo->prepare('SELECT * FROM `users` WHERE `id` = ?'); $st->execute([$id]);
            $u = $st->fetch(); if (!$u) throw new RuntimeException('No such account.');
            $next = (int)($u['is_admin'] ?? 0) === 1 ? 0 : 1;
            if ($next === 0 && admin_count() <= 1) throw new RuntimeException('That is the last admin.');
            $pdo->prepare('UPDATE `users` SET `is_admin` = ? WHERE `id` = ?')->execute([$next, $id]);
            $notice = $u['email'] . ($next ? ' is now an admin.' : ' is no longer an admin.');
        }

        elseif ($do === 'clear_password') {
            $st = $pdo->prepare('SELECT * FROM `users` WHERE `id` = ?'); $st->execute([$id]);
            $u = $st->fetch(); if (!$u) throw new RuntimeException('No such account.');
            $pdo->prepare('UPDATE `users` SET `password_hash` = NULL WHERE `id` = ?')->execute([$id]);
            $notice = $u['email'] . ' now signs in with Google only.';
        }

        elseif ($do === 'set_password') {
            $pw = (string)($_POST['password'] ?? '');
            if (strlen($pw) < 10) throw new RuntimeException('A password needs at least 10 characters.');
            $st = $pdo->prepare('SELECT * FROM `users` WHERE `id` = ?'); $st->execute([$id]);
            $u = $st->fetch(); if (!$u) throw new RuntimeException('No such account.');
            $pdo->prepare('UPDATE `users` SET `password_hash` = ? WHERE `id` = ?')
                ->execute([password_hash($pw, PASSWORD_DEFAULT), $id]);
            $notice = 'Password set for ' . $u['email'] . '.';
        }

        elseif ($do === 'delete') {
            if ($id === $me) throw new RuntimeException('You cannot delete your own account.');
            $st = $pdo->prepare('SELECT * FROM `users` WHERE `id` = ?'); $st->execute([$id]);
            $u = $st->fetch(); if (!$u) throw new RuntimeException('No such account.');
            if ((int)($u['is_admin'] ?? 0) === 1 && admin_count() <= 1) throw new RuntimeException('That is the last admin.');
            $pdo->prepare('DELETE FROM `users` WHERE `id` = ?')->execute([$id]);
            $notice = $u['email'] . ' removed.';
        }
    } catch (Throwable $e) {
        $problem = $e->getMessage();
    }
}

$users = [];
if (($state ?? '') === 'ok') {
    $users = db()->query('SELECT * FROM `users` ORDER BY `is_active` DESC, `email`')->fetchAll();
}
$cfg = config() ?? [];
$googleOn  = trim((string)($cfg['google_client_id'] ?? '')) !== '';
$passwords = !isset($cfg['allow_password_login']) || (bool)$cfg['allow_password_login'];
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Users — Giant Motor Cars CRM</title>
<style>
:root{--ink:#0F1115;--muted:#6B7280;--line:#E4E7EC;--primary:#047857;--primary-ink:#065F46;--paper:#F4F5F7}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;
  display:grid;place-items:start center;min-height:100vh;padding:36px 20px}
.box{background:#fff;border:1px solid var(--line);border-radius:16px;padding:30px;width:100%;max-width:840px;
  box-shadow:0 12px 40px rgba(16,17,21,.10)}
h1{font-size:21px;margin:0 0 4px}
h2{font-size:14px;margin:26px 0 10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.sub{color:var(--muted);font-size:13.5px;margin-bottom:20px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:8px 9px;border-bottom:1px solid var(--line)}
td{padding:10px 9px;border-bottom:1px solid #EDEFF3;font-size:14px;vertical-align:middle}
tr.off td{opacity:.5}
.pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;display:inline-block}
.pill.g{background:#E7F6F0;color:#065F46}
.pill.p{background:#EEF2FF;color:#4338CA}
.pill.a{background:#FEF3C7;color:#92400E}
.acts{display:flex;gap:5px;flex-wrap:wrap}
.acts button{padding:5px 9px;border-radius:7px;border:1px solid var(--line);background:#fff;font-size:12px;font-weight:600;color:#414652;cursor:pointer}
.acts button:hover{border-color:var(--primary);color:var(--primary)}
.acts button.danger:hover{border-color:#FCA5A5;color:#B91C1C}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin:14px 0 5px}
input[type=text],input[type=email],input[type=password]{width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:9px;font-size:14px;outline:none}
input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(4,120,87,.12)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
button.go{margin-top:20px;height:42px;padding:0 22px;background:var(--primary);color:#fff;border:none;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer}
button.go:hover{background:var(--primary-ink)}
.chk{display:flex;gap:9px;align-items:center;margin-top:14px;font-size:14px;cursor:pointer}
.chk input{width:17px;height:17px;accent-color:var(--primary)}
.err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:11px 13px;border-radius:9px;font-size:13.5px;margin-bottom:16px}
.ok{background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;padding:11px 13px;border-radius:9px;font-size:13.5px;margin-bottom:16px}
.warn{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;padding:11px 13px;border-radius:9px;font-size:13px;margin-bottom:16px}
.hint{font-size:12.5px;color:var(--muted);margin-top:6px;line-height:1.5}
a{color:var(--primary);font-weight:600}
code{background:#EDEFF3;padding:2px 6px;border-radius:5px;font-size:12.5px}
</style>
</head>
<body>
<div class="box">
  <h1>Users</h1>
  <div class="sub">Who can sign in to the CRM</div>

  <?php if ($state === 'anon'): ?>
    <div class="err">Sign in to the CRM first, then reload this page.</div>
    <a href="index.html">Go to the CRM →</a>

  <?php elseif ($state === 'forbidden'): ?>
    <div class="err">Only an admin can manage users.</div>
    <a href="index.html">Back to the CRM →</a>

  <?php else: ?>
    <?php if ($problem): ?><div class="err"><?= h($problem) ?></div><?php endif; ?>
    <?php if ($notice):  ?><div class="ok"><?= h($notice) ?></div><?php endif; ?>

    <?php if (!$googleOn): ?>
      <div class="warn">Google sign-in isn't configured yet — run <a href="upgrade.php">upgrade.php</a> and paste
        in your client ID. Until then everyone needs a password.</div>
    <?php endif; ?>

    <table>
      <tr><th>Person</th><th>Signs in with</th><th>Last seen</th><th></th></tr>
      <?php foreach ($users as $u):
        $hasPw = ($u['password_hash'] ?? null) !== null && $u['password_hash'] !== '';
        $isMe  = $u['id'] === $me; ?>
        <tr class="<?= (int)$u['is_active'] === 1 ? '' : 'off' ?>">
          <td>
            <b><?= h($u['name'] !== '' ? $u['name'] : explode('@', (string)$u['email'])[0]) ?></b>
            <?= $isMe ? ' <span class="pill p">you</span>' : '' ?>
            <?= (int)($u['is_admin'] ?? 0) === 1 ? ' <span class="pill a">admin</span>' : '' ?>
            <div class="hint"><?= h($u['email']) ?><?= (int)$u['is_active'] === 1 ? '' : ' · deactivated' ?></div>
          </td>
          <td>
            <span class="pill g">Google</span>
            <?= $hasPw ? ' <span class="pill p">password</span>' : '' ?>
          </td>
          <td class="hint"><?= $u['last_login_at'] ? h(substr((string)$u['last_login_at'], 0, 16)) : 'never' ?></td>
          <td>
            <div class="acts">
              <?php if (!$isMe): ?>
                <form method="post" style="display:inline"><input type="hidden" name="do" value="toggle_active">
                  <input type="hidden" name="id" value="<?= h($u['id']) ?>">
                  <button><?= (int)$u['is_active'] === 1 ? 'Deactivate' : 'Reactivate' ?></button></form>
                <form method="post" style="display:inline"><input type="hidden" name="do" value="toggle_admin">
                  <input type="hidden" name="id" value="<?= h($u['id']) ?>">
                  <button><?= (int)($u['is_admin'] ?? 0) === 1 ? 'Remove admin' : 'Make admin' ?></button></form>
              <?php endif; ?>
              <?php if ($hasPw): ?>
                <form method="post" style="display:inline"
                      onsubmit="return confirm('<?= h($u['email']) ?> will only be able to sign in with Google. Continue?');">
                  <input type="hidden" name="do" value="clear_password">
                  <input type="hidden" name="id" value="<?= h($u['id']) ?>">
                  <button>Remove password</button></form>
              <?php endif; ?>
              <?php if (!$isMe): ?>
                <form method="post" style="display:inline"
                      onsubmit="return confirm('Remove <?= h($u['email']) ?> completely?');">
                  <input type="hidden" name="do" value="delete">
                  <input type="hidden" name="id" value="<?= h($u['id']) ?>">
                  <button class="danger">Remove</button></form>
              <?php endif; ?>
            </div>
          </td>
        </tr>
      <?php endforeach; ?>
    </table>

    <h2>Add someone</h2>
    <form method="post">
      <input type="hidden" name="do" value="add">
      <div class="row">
        <div><label>Name</label><input type="text" name="name" placeholder="Rami Saleh"></div>
        <div><label>Google email</label><input type="email" name="email" placeholder="someone@giantmotorcars.com" required></div>
      </div>
      <div class="hint">This must be the address they actually sign in to Google with. Nothing is emailed to
        them — tell them to open the CRM and press <b>Sign in with Google</b>.</div>

      <?php if ($passwords): ?>
        <label>Password <span style="text-transform:none;font-weight:400">(optional — leave blank for Google only)</span></label>
        <input type="password" name="password" autocomplete="new-password">
        <div class="hint">Best left empty. A password is one more thing that can be guessed or reused;
          Google sign-in has neither problem.</div>
      <?php endif; ?>

      <label class="chk"><input type="checkbox" name="is_admin"> <span>Can manage users</span></label>
      <button class="go" type="submit">Add</button>
    </form>

    <div class="hint" style="margin-top:24px">
      <a href="index.html">← Back to the CRM</a>
    </div>
  <?php endif; ?>
</div>
</body>
</html>
