<?php
/* ============================================================
   Giant Motor Cars CRM — V2 table whitelist

   Nothing reaches SQL unless it appears here. Table names,
   column names and ORDER BY targets can't be parameterised by
   the driver, so this list is what makes them safe — the API
   rejects anything it doesn't recognise rather than escaping it.

   Types drive coercion on the way in: '' becomes NULL for dates
   and numbers (MySQL in strict mode rejects '' for a DATE), ISO
   timestamps from the browser become MySQL DATETIME, and
   booleans become 1/0.
   ============================================================ */

const COL_TYPES = [
    'leads' => [
        'id'               => 'uuid',
        'dc_id'            => 'str',
        'name'             => 'str',
        'phone'            => 'str',
        'email'            => 'str',
        'vehicle'          => 'str',
        'stock_number'     => 'str',
        'source'           => 'str',
        'status'           => 'str',
        'deal_type'        => 'str',
        'assigned_to'      => 'str',
        'credit_score'     => 'int',
        'notes'            => 'text',
        'email_opt_out'    => 'bool',
        'created_at'       => 'datetime',
        'updated_at'       => 'datetime',
        'stage_changed_at' => 'datetime',
    ],
    'sold_customers' => [
        'id'                       => 'uuid',
        'first_name'               => 'str',
        'last_name'                => 'str',
        'home_phone'               => 'str',
        'cell_phone'               => 'str',
        'email'                    => 'str',
        'sale_date'                => 'date',
        'sale_type'                => 'str',
        'veh_year'                 => 'str',
        'veh_make'                 => 'str',
        'veh_model'                => 'str',
        'vin'                      => 'str',
        'vin_last6'                => 'str',
        'first_payment_date'       => 'date',
        'note_payment_amount'      => 'dec',
        'pay_schedule'             => 'str',
        'num_payments'             => 'str',
        'current_due_date'         => 'date',
        'service_contract'         => 'str',
        'service_contract_company' => 'str',
        'lien_holder'              => 'str',
        'cobuyer_first'            => 'str',
        'cobuyer_last'             => 'str',
        'cobuyer_home_phone'       => 'str',
        'cobuyer_email'            => 'str',
        'tag_in'                   => 'bool',
        'tag_cost'                 => 'dec',
        'tag_number'               => 'str',
        'email_opt_out'            => 'bool',
        'created_at'               => 'datetime',
        'updated_at'               => 'datetime',
    ],
    'message_templates' => [
        'id'          => 'uuid',
        'name'        => 'str',
        'subject'     => 'text',
        'body'        => 'text',
        'category'    => 'str',
        'record_type' => 'str',
        'channel'     => 'str',
        'is_active'   => 'bool',
        'sort_order'  => 'int',
        'created_by'  => 'str',
        'created_at'  => 'datetime',
        'updated_at'  => 'datetime',
    ],
    'messages' => [
        'id'                  => 'uuid',
        'record_type'         => 'str',
        'record_id'           => 'str',
        'template_id'         => 'str',
        'channel'             => 'str',
        'to_address'          => 'str',
        'to_name'             => 'str',
        'subject'             => 'text',
        'body'                => 'text',
        'status'              => 'str',
        'error'               => 'text',
        'provider_message_id' => 'str',
        'provider_thread_id'  => 'str',
        'batch_id'            => 'str',
        'sent_by'             => 'str',
        'from_address'        => 'str',
        'sent_at'             => 'datetime',
        'created_at'          => 'datetime',
    ],
    'lead_activities' => [
        'id'         => 'uuid',
        'lead_id'    => 'str',
        'author'     => 'str',
        'type'       => 'str',
        'body'       => 'text',
        'created_at' => 'datetime',
    ],
];

/* Columns the client may never set directly. `updated_at` maintains
   itself; `users` is not reachable through the data API at all. */
const READONLY_COLS = ['updated_at'];

function table_exists_in_schema(string $t): bool {
    return array_key_exists($t, COL_TYPES);
}

function column_allowed(string $t, string $c): bool {
    return isset(COL_TYPES[$t][$c]);
}

function column_writable(string $t, string $c): bool {
    return column_allowed($t, $c) && !in_array($c, READONLY_COLS, true);
}

function column_type(string $t, string $c): string {
    return COL_TYPES[$t][$c] ?? 'str';
}
