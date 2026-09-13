<?php
/* Copy this to config.php and fill it in — or let setup.php write it for you.
   config.php holds a live database password: never commit it. */
return [
    'db_host' => 'localhost',
    'db_port' => '3306',
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',

    // Sign in with Google. Same OAuth client id the pages use for Gmail.
    'google_client_id' => '',

    // Turn this off once Google sign-in works for everyone: with no password
    // accepted anywhere, there is nothing left to brute force.
    'allow_password_login' => true,
];
