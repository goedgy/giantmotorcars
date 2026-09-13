<?php
/* ============================================================
   Giant Motor Cars CRM — V2 natural keys

   The primary key can't tell you two rows are the same record: a
   re-import mints a fresh UUID for every row, so the same customer
   arrives twice under two different ids. A *natural* key — something
   about the record itself — can.

   sold_customers deliberately uses VIN + last name, the same pair
   the app's own Frazer importer matches on (see matchExisting() in
   sold.html), so the two agree about what counts as a duplicate.

   Used by both import-supabase.php and fix-duplicates.php. One
   definition, so they can't drift apart.
   ============================================================ */

declare(strict_types=1);

function nk_norm($s): string { return strtolower(trim((string)$s)); }
function nk_digits($s): string { return preg_replace('/\D/', '', (string)$s) ?? ''; }

/* Returns null when a row carries nothing identifying — those are left
   alone rather than guessed at. */
function natural_key(string $table, array $r): ?string {
    switch ($table) {

        case 'sold_customers':
            $vin = strtoupper(trim((string)($r['vin'] ?? '')));
            if ($vin !== '') return 'vin:' . $vin . '|' . nk_norm($r['last_name'] ?? '');

            $name = nk_norm($r['first_name'] ?? '') . '|' . nk_norm($r['last_name'] ?? '');
            $last6 = strtoupper(trim((string)($r['vin_last6'] ?? '')));
            if ($last6 !== '' && trim($name, '|') !== '') return 'v6:' . $last6 . '|' . $name;

            $sold = substr((string)($r['sale_date'] ?? ''), 0, 10);
            if (trim($name, '|') !== '' && $sold !== '') return 'ns:' . $name . '|' . $sold;
            return null;

        case 'leads':
            $dc = trim((string)($r['dc_id'] ?? ''));
            if ($dc !== '') return 'dc:' . strtolower($dc);

            $name = nk_norm($r['name'] ?? '');
            if ($name === '') return null;
            $phone = nk_digits($r['phone'] ?? '');
            if ($phone !== '') return 'np:' . $name . '|' . $phone;
            $email = nk_norm($r['email'] ?? '');
            if ($email !== '') return 'ne:' . $name . '|' . $email;
            // A name on its own is not enough — two walk-ins can share one.
            return null;

        case 'message_templates':
            $n = nk_norm($r['name'] ?? '');
            return $n === '' ? null : 'tpl:' . $n . '|' . nk_norm($r['record_type'] ?? '');

        case 'messages':
            // Gmail's own id is definitive when we have it.
            $pm = trim((string)($r['provider_message_id'] ?? ''));
            if ($pm !== '') return 'pm:' . $pm;
            $rid = trim((string)($r['record_id'] ?? ''));
            $at  = substr((string)($r['created_at'] ?? ''), 0, 19);
            if ($rid === '' || $at === '') return null;
            return 'msg:' . $rid . '|' . $at . '|' . substr(nk_norm($r['subject'] ?? ''), 0, 60);

        case 'lead_activities':
            $lid = trim((string)($r['lead_id'] ?? ''));
            $at  = substr((string)($r['created_at'] ?? ''), 0, 19);
            if ($lid === '' || $at === '') return null;
            return 'act:' . $lid . '|' . $at . '|' . substr(nk_norm($r['body'] ?? ''), 0, 60);
    }
    return null;
}

/* Rows that point at a parent row, so a merge can carry them over to the
   survivor instead of orphaning email history. */
const CHILD_REFS = [
    'sold_customers' => [
        ['table' => 'messages', 'column' => 'record_id', 'scope' => "`record_type` = 'sold'"],
    ],
    'leads' => [
        ['table' => 'messages',        'column' => 'record_id', 'scope' => "`record_type` = 'lead'"],
        ['table' => 'lead_activities', 'column' => 'lead_id',   'scope' => null],
    ],
];

/* When two rows are the same record, keep the one carrying the most
   filled-in fields; on a tie the older one wins, since that's the copy
   everything else already points at. */
function row_score(array $r): int {
    $n = 0;
    foreach ($r as $k => $v) {
        if ($k === 'id' || $k === 'created_at' || $k === 'updated_at') continue;
        if ($v !== null && trim((string)$v) !== '' && $v !== '0') $n++;
    }
    return $n;
}

function pick_survivor(array $rows): array {
    usort($rows, static function (array $a, array $b): int {
        $s = row_score($b) <=> row_score($a);          // most complete first
        if ($s !== 0) return $s;
        return strcmp((string)($a['created_at'] ?? ''), (string)($b['created_at'] ?? ''));  // then oldest
    });
    $keep = array_shift($rows);
    return [$keep, $rows];
}
