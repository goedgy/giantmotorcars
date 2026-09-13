<?php
/* ============================================================
   Giant Motor Cars CRM — V2 duplicate cleanup

   Finds rows that are the same record under different ids — what a
   re-run of the importer produces — and merges each group down to
   one.

   It does not simply delete. The survivor first absorbs any field
   the copies have filled in and it doesn't, and anything pointing
   at a doomed row (sent email, lead activity) is repointed to the
   survivor. Nothing is lost but the duplicate shell.

   Shows you the damage before touching anything. Delete this file
   once the data is clean.
   ============================================================ */

declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';
require_once __DIR__ . '/api/dupkeys.php';

start_session();
$signedIn = isset($_SESSION['uid']);

$TABLES = ['sold_customers', 'leads', 'message_templates', 'messages', 'lead_activities'];

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

/* Group every row by natural key and return only the groups with more
   than one member. */
function find_dupes(string $table): array {
    $rows = db()->query("SELECT * FROM `{$table}`")->fetchAll();
    $groups = [];
    $unkeyed = 0;
    foreach ($rows as $r) {
        $k = natural_key($table, $r);
        if ($k === null) { $unkeyed++; continue; }
        $groups[$k][] = $r;
    }
    $dupes = array_filter($groups, static fn(array $g): bool => count($g) > 1);
    $extra = 0;
    foreach ($dupes as $g) $extra += count($g) - 1;
    return ['total' => count($rows), 'groups' => $dupes, 'extra' => $extra, 'unkeyed' => $unkeyed];
}

function label(string $table, array $r): string {
    switch ($table) {
        case 'sold_customers':
            return trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''))
                 . (($r['vin'] ?? '') ? ' · VIN ' . $r['vin'] : '')
                 . (($r['sale_date'] ?? '') ? ' · ' . $r['sale_date'] : '');
        case 'leads':
            return ($r['name'] ?? '') . (($r['phone'] ?? '') ? ' · ' . $r['phone'] : '');
        case 'message_templates':
            return ($r['name'] ?? '') . ' · ' . ($r['record_type'] ?? '');
        case 'messages':
            return ($r['to_address'] ?? '') . ' · ' . substr((string)($r['subject'] ?? ''), 0, 50);
        case 'lead_activities':
            return substr((string)($r['body'] ?? ''), 0, 60);
    }
    return (string)($r['id'] ?? '');
}

function merge_table(string $table): array {
    $found = find_dupes($table);
    if (!$found['groups']) return ['table' => $table, 'merged' => 0, 'filled' => 0, 'moved' => 0];

    $pdo = db();
    $merged = 0; $filled = 0; $moved = 0;

    $pdo->beginTransaction();
    try {
        foreach ($found['groups'] as $group) {
            [$keep, $drop] = pick_survivor($group);

            // 1. the survivor takes any value it's missing that a copy has
            $patch = [];
            foreach ($drop as $d) {
                foreach ($d as $col => $val) {
                    if (in_array($col, ['id', 'created_at', 'updated_at'], true)) continue;
                    if (!column_writable($table, (string)$col)) continue;
                    $have = $keep[$col] ?? null;
                    if (($have === null || trim((string)$have) === '') && $val !== null && trim((string)$val) !== '') {
                        $patch[$col] = $val;
                        $keep[$col]  = $val;
                    }
                }
            }
            if ($patch) {
                $sets = implode(', ', array_map(static fn($c) => "`{$c}` = ?", array_keys($patch)));
                $st = $pdo->prepare("UPDATE `{$table}` SET {$sets} WHERE `id` = ?");
                $st->execute(array_merge(array_values($patch), [$keep['id']]));
                $filled += count($patch);
            }

            // 2. anything pointing at a doomed row now points at the survivor
            $deadIds = array_column($drop, 'id');
            foreach (CHILD_REFS[$table] ?? [] as $ref) {
                $marks = implode(',', array_fill(0, count($deadIds), '?'));
                $scope = $ref['scope'] ? ' AND ' . $ref['scope'] : '';
                $st = $pdo->prepare(
                    "UPDATE `{$ref['table']}` SET `{$ref['column']}` = ? WHERE `{$ref['column']}` IN ({$marks}){$scope}"
                );
                $st->execute(array_merge([$keep['id']], $deadIds));
                $moved += $st->rowCount();
            }

            // 3. and only now is the shell removed
            $marks = implode(',', array_fill(0, count($deadIds), '?'));
            $st = $pdo->prepare("DELETE FROM `{$table}` WHERE `id` IN ({$marks})");
            $st->execute($deadIds);
            $merged += $st->rowCount();
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return ['table' => $table, 'merged' => $merged, 'filled' => $filled, 'moved' => $moved];
}

$scan = null; $results = null; $problem = '';

if ($signedIn) {
    $doMerge = ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['confirm'] ?? '') === 'MERGE');
    try {
        if ($doMerge) {
            $results = [];
            foreach ($TABLES as $t) $results[] = merge_table($t);
        }
        $scan = [];
        foreach ($TABLES as $t) $scan[$t] = find_dupes($t);
    } catch (Throwable $e) {
        $problem = $e->getMessage();
    }
}

$totalExtra = $scan ? array_sum(array_column($scan, 'extra')) : 0;
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fix duplicates — Giant Motor Cars CRM</title>
<style>
:root{--ink:#0F1115;--muted:#6B7280;--line:#E4E7EC;--primary:#047857;--primary-ink:#065F46;--paper:#F4F5F7}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;
  display:grid;place-items:start center;min-height:100vh;padding:36px 20px}
.box{background:#fff;border:1px solid var(--line);border-radius:16px;padding:30px;width:100%;max-width:760px;
  box-shadow:0 12px 40px rgba(16,17,21,.10)}
h1{font-size:21px;margin:0 0 4px}
.sub{color:var(--muted);font-size:13.5px;margin-bottom:22px}
table{width:100%;border-collapse:collapse;margin:14px 0}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);
  padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:9px 10px;border-bottom:1px solid #EDEFF3;font-size:14px}
td.n{font-variant-numeric:tabular-nums;text-align:right}
.dupe{color:#B45309;font-weight:700}
.zero{color:var(--muted)}
button{margin-top:20px;width:100%;height:44px;background:#B91C1C;color:#fff;border:none;border-radius:10px;
  font-weight:600;font-size:15px;cursor:pointer}
button:hover{background:#991B1B}
button.calm{background:var(--primary)}
button.calm:hover{background:var(--primary-ink)}
.ok{background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;padding:12px 14px;border-radius:9px;font-size:14px;margin-bottom:16px}
.err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:12px 14px;border-radius:9px;font-size:14px;margin-bottom:16px}
.warn{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;padding:12px 14px;border-radius:9px;font-size:13.5px;margin-bottom:16px}
details{margin:6px 0 0}
summary{cursor:pointer;font-size:13px;color:var(--primary);font-weight:600}
.grp{font-size:12.5px;color:var(--muted);padding:6px 0 6px 14px;border-left:2px solid var(--line);margin:8px 0}
.grp b{color:var(--ink)}
code{background:#EDEFF3;padding:2px 6px;border-radius:5px;font-size:12.5px}
a{color:var(--primary);font-weight:600}
</style>
</head>
<body>
<div class="box">
  <h1>Fix duplicates</h1>
  <div class="sub">Merges rows that are the same record under different ids</div>

  <?php if (!$signedIn): ?>
    <div class="err">Sign in to the CRM first, then reload this page.</div>
    <a href="index.html">Go to the CRM →</a>

  <?php else: ?>
    <?php if ($problem): ?><div class="err"><?= h($problem) ?></div><?php endif; ?>

    <?php if ($results): ?>
      <?php $m = array_sum(array_column($results, 'merged'));
            $f = array_sum(array_column($results, 'filled'));
            $mv = array_sum(array_column($results, 'moved')); ?>
      <div class="ok">
        <b><?= (int)$m ?></b> duplicate row<?= $m === 1 ? '' : 's' ?> merged away.
        <?= $f ? "<br><b>{$f}</b> empty field" . ($f === 1 ? '' : 's') . " filled in on the rows that were kept." : '' ?>
        <?= $mv ? "<br><b>{$mv}</b> linked record" . ($mv === 1 ? '' : 's') . " (emails, activities) moved to the kept row." : '' ?>
      </div>
    <?php endif; ?>

    <table>
      <tr><th>Table</th><th class="n">Rows</th><th class="n">Duplicate groups</th><th class="n">Extra copies</th></tr>
      <?php foreach ($scan as $t => $s): ?>
        <tr>
          <td><code><?= h($t) ?></code></td>
          <td class="n"><?= (int)$s['total'] ?></td>
          <td class="n <?= $s['groups'] ? 'dupe' : 'zero' ?>"><?= count($s['groups']) ?></td>
          <td class="n <?= $s['extra'] ? 'dupe' : 'zero' ?>"><?= (int)$s['extra'] ?></td>
        </tr>
      <?php endforeach; ?>
    </table>

    <?php if ($totalExtra): ?>
      <?php foreach ($scan as $t => $s): if (!$s['groups']) continue; ?>
        <details>
          <summary><?= h($t) ?> — <?= count($s['groups']) ?> group<?= count($s['groups']) === 1 ? '' : 's' ?>, showing up to 8</summary>
          <?php foreach (array_slice($s['groups'], 0, 8) as $g): ?>
            <div class="grp"><b><?= h(label($t, $g[0])) ?></b> — <?= count($g) ?> copies</div>
          <?php endforeach; ?>
        </details>
      <?php endforeach; ?>

      <div class="warn" style="margin-top:18px">
        For each group the most complete row is kept (oldest wins a tie). It absorbs any field
        only the copies have, and their emails and activities are moved onto it first — so nothing
        is lost except the duplicate shell. <b>Back up first:</b> cPanel → Backup, or
        phpMyAdmin → Export.
      </div>

      <form method="post" onsubmit="return confirm('Merge <?= (int)$totalExtra ?> duplicate rows? Back up the database first.');">
        <input type="hidden" name="confirm" value="MERGE">
        <button type="submit">Merge <?= (int)$totalExtra ?> duplicate row<?= $totalExtra === 1 ? '' : 's' ?></button>
      </form>
    <?php else: ?>
      <div class="ok">No duplicates found. Nothing to do.</div>
      <a href="index.html">Go to the CRM →</a>
    <?php endif; ?>

    <?php $unkeyed = array_sum(array_column($scan, 'unkeyed')); if ($unkeyed): ?>
      <div class="warn" style="margin-top:14px">
        <?= (int)$unkeyed ?> row<?= $unkeyed === 1 ? ' carries' : 's carry' ?> too little to identify
        (no VIN, no name, no phone). Those are left alone — check them by hand if the counts still look wrong.
      </div>
    <?php endif; ?>
  <?php endif; ?>
</div>
</body>
</html>
