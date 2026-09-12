<?php
/* ============================================================
   Giant Motor Cars CRM — V2 Supabase CSV importer

   Export a table from Supabase (Table Editor → … → Export as CSV)
   and drop the file in here. Columns are matched by header name,
   values are run through the same coercion the API uses — so
   Postgres booleans, ISO timestamps and empty strings land as
   MySQL TINYINT, DATETIME and NULL rather than errors.

   Rows whose id already exists are skipped, so a half-finished
   import can be re-run against the same file safely.

   Requires a signed-in session. Delete this file once migrated.
   ============================================================ */

declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

start_session();
$signedIn = isset($_SESSION['uid']);

$IMPORTABLE = ['leads', 'sold_customers', 'message_templates', 'messages', 'lead_activities'];

$report = null;
$problem = '';

function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

if ($signedIn && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $table = (string)($_POST['table'] ?? '');
    if (!in_array($table, $IMPORTABLE, true)) {
        $problem = 'Pick a table.';
    } elseif (!isset($_FILES['csv']) || $_FILES['csv']['error'] !== UPLOAD_ERR_OK) {
        $problem = 'Upload a CSV file. (A file bigger than ' . ini_get('upload_max_filesize') . ' is rejected before PHP sees it.)';
    } else {
        $report = import_csv($table, $_FILES['csv']['tmp_name']);
    }
}

function import_csv(string $table, string $path): array {
    $fh = fopen($path, 'r');
    if (!$fh) return ['error' => 'Could not read the upload.'];

    $header = fgetcsv($fh);
    if (!$header) return ['error' => 'That file has no header row.'];

    // Supabase sometimes writes a UTF-8 BOM on the first header cell.
    $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string)$header[0]);

    $known = [];
    $ignored = [];
    foreach ($header as $i => $name) {
        $name = trim((string)$name);
        if (column_writable($table, $name)) $known[$i] = $name;
        elseif ($name !== '')               $ignored[] = $name;
    }
    if (!$known) return ['error' => 'None of those column headers match the ' . $table . ' table.'];

    $pdo = db();
    $have = [];
    foreach ($pdo->query("SELECT `id` FROM `{$table}`")->fetchAll(PDO::FETCH_COLUMN) as $id) $have[$id] = true;

    $inserted = 0; $skipped = 0; $failed = 0; $errors = [];
    $line = 1;

    $pdo->beginTransaction();
    while (($row = fgetcsv($fh)) !== false) {
        $line++;
        if (count(array_filter($row, static fn($v) => trim((string)$v) !== '')) === 0) continue;  // blank line

        $data = [];
        foreach ($known as $i => $col) {
            $data[$col] = coerce($row[$i] ?? null, column_type($table, $col));
        }
        if (empty($data['id'])) $data['id'] = uuid4();
        if (isset($have[$data['id']])) { $skipped++; continue; }

        try {
            $cols  = array_keys($data);
            $names = implode(',', array_map(static fn($c) => "`{$c}`", $cols));
            $marks = implode(',', array_fill(0, count($cols), '?'));
            $pdo->prepare("INSERT INTO `{$table}` ({$names}) VALUES ({$marks})")->execute(array_values($data));
            $have[$data['id']] = true;
            $inserted++;
        } catch (Throwable $e) {
            $failed++;
            if (count($errors) < 5) $errors[] = "line {$line}: " . $e->getMessage();
        }
    }
    $pdo->commit();
    fclose($fh);

    return compact('inserted', 'skipped', 'failed', 'errors', 'ignored') + ['table' => $table];
}
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Import from Supabase — Giant Motor Cars CRM</title>
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
select,input[type=file]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;font-size:14px;background:#fff}
button{margin-top:22px;width:100%;height:42px;background:var(--primary);color:#fff;border:none;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer}
button:hover{background:var(--primary-ink)}
.err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:11px 13px;border-radius:9px;font-size:13.5px;margin-bottom:16px}
.ok{background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;padding:11px 13px;border-radius:9px;font-size:13.5px;margin-bottom:16px}
.warn{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;padding:11px 13px;border-radius:9px;font-size:13px;margin-bottom:16px}
ol{margin:0 0 8px;padding-left:20px;font-size:14px}
li{margin-bottom:5px}
code{background:#EDEFF3;padding:2px 6px;border-radius:5px;font-size:12.5px}
a{color:var(--primary);font-weight:600}
.small{font-size:12.5px;color:var(--muted);margin-top:8px;line-height:1.5}
</style>
</head>
<body>
<div class="box">
  <h1>Import from Supabase</h1>
  <div class="sub">One table at a time, from a CSV export</div>

  <?php if (!$signedIn): ?>
    <div class="err">Sign in to the CRM first, then come back to this page.</div>
    <a href="index.html">Go to the CRM →</a>

  <?php else: ?>
    <?php if ($problem): ?><div class="err"><?= h($problem) ?></div><?php endif; ?>

    <?php if ($report && isset($report['error'])): ?>
      <div class="err"><?= h($report['error']) ?></div>
    <?php elseif ($report): ?>
      <div class="ok">
        <b><?= (int)$report['inserted'] ?></b> rows imported into <code><?= h($report['table']) ?></code>
        <?= $report['skipped'] ? ' · ' . (int)$report['skipped'] . ' already present, skipped' : '' ?>
        <?= $report['failed']  ? ' · ' . (int)$report['failed']  . ' failed' : '' ?>
      </div>
      <?php if ($report['ignored']): ?>
        <div class="warn">Columns in the file with no matching field, ignored:
          <?= h(implode(', ', array_slice($report['ignored'], 0, 12))) ?></div>
      <?php endif; ?>
      <?php foreach ($report['errors'] as $e): ?>
        <div class="err"><?= h($e) ?></div>
      <?php endforeach; ?>
    <?php endif; ?>

    <ol>
      <li>In Supabase open <b>Table Editor</b>, pick the table.</li>
      <li>Top-right <b>…</b> menu → <b>Export data as CSV</b>.</li>
      <li>Upload it below against the matching table here.</li>
    </ol>
    <div class="small">Import <code>leads</code> and <code>sold_customers</code> first — <code>messages</code>
      and <code>lead_activities</code> refer to their ids. Re-running the same file is harmless: rows whose
      id already exists are skipped.</div>

    <form method="post" enctype="multipart/form-data">
      <label>Table</label>
      <select name="table">
        <?php foreach ($IMPORTABLE as $t): ?>
          <option value="<?= h($t) ?>" <?= (($_POST['table'] ?? '') === $t) ? 'selected' : '' ?>><?= h($t) ?></option>
        <?php endforeach; ?>
      </select>
      <label>CSV file</label>
      <input type="file" name="csv" accept=".csv,text/csv" required>
      <button type="submit">Import</button>
    </form>
    <div class="small">Upload limit on this server: <?= h(ini_get('upload_max_filesize')) ?>.
      For a bigger file, split the CSV or raise <code>upload_max_filesize</code> in cPanel’s MultiPHP INI Editor.</div>
  <?php endif; ?>
</div>
</body>
</html>
