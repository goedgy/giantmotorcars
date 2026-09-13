<?php
/* ============================================================
   Giant Motor Cars CRM — V2 Google sign-in

   Verifies the ID token that "Sign in with Google" hands the
   browser, so a session can be created without a password ever
   existing to guess.

   Verification is done here rather than by calling Google's
   tokeninfo endpoint on every login: the signing keys are fetched
   once and cached for hours, so a sign-in costs no round trip and
   doesn't break if that endpoint rate-limits.

   What gets checked, in order — skipping any one of these is how
   this kind of code goes wrong:
     - three-part JWT, header alg is RS256 (never "none")
     - signature verifies against the Google key named by `kid`
     - `iss`  is Google
     - `aud`  is OUR client id, so a token minted for some other
              site can't be replayed here
     - `exp`  hasn't passed, `iat` isn't from the future
     - `email_verified` is true

   Being a valid Google account is not enough to get in — the
   address must also be listed in the `users` table. That check
   lives in index.php, where the session is created.
   ============================================================ */

declare(strict_types=1);

const GOOGLE_ISSUERS  = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_TTL        = 21600;   // 6 hours
const CLOCK_SKEW      = 120;     // seconds of tolerance either way

function b64url_decode(string $s): string {
    $s = strtr($s, '-_', '+/');
    $pad = strlen($s) % 4;
    if ($pad) $s .= str_repeat('=', 4 - $pad);
    $out = base64_decode($s, true);
    if ($out === false) throw new RuntimeException('Malformed base64url in token.');
    return $out;
}

function http_get(string $url): string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT      => 'gmc-crm',
        ]);
        $body = curl_exec($ch);
        $err  = curl_error($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($body === false || $code !== 200) {
            throw new RuntimeException('Could not reach Google (' . ($err ?: "HTTP {$code}") . ').');
        }
        return (string)$body;
    }
    $body = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 10]]));
    if ($body === false) throw new RuntimeException('Could not reach Google. Enable cURL or allow_url_fopen.');
    return $body;
}

function jwks_cache_path(): string {
    return rtrim(sys_get_temp_dir(), '/') . '/gmc_google_jwks_' . substr(sha1(GOOGLE_JWKS_URL), 0, 12) . '.json';
}

function google_jwks(bool $force = false): array {
    $path = jwks_cache_path();
    if (!$force && is_file($path) && (time() - (int)filemtime($path)) < JWKS_TTL) {
        $cached = json_decode((string)@file_get_contents($path), true);
        if (is_array($cached) && !empty($cached['keys'])) return $cached;
    }
    $raw  = http_get(GOOGLE_JWKS_URL);
    $keys = json_decode($raw, true);
    if (!is_array($keys) || empty($keys['keys'])) throw new RuntimeException('Google returned no signing keys.');
    @file_put_contents($path, $raw);
    return $keys;
}

/* Builds a PEM public key out of the JWK's modulus and exponent.
   openssl_verify() needs PEM and PHP has no JWK importer, so the
   SubjectPublicKeyInfo structure is assembled here by hand. */
function der_len(int $n): string {
    if ($n < 0x80) return chr($n);
    $b = '';
    while ($n > 0) { $b = chr($n & 0xff) . $b; $n >>= 8; }
    return chr(0x80 | strlen($b)) . $b;
}

function der_uint(string $bin): string {
    $bin = ltrim($bin, "\x00");
    if ($bin === '') $bin = "\x00";
    if (ord($bin[0]) & 0x80) $bin = "\x00" . $bin;   // leading bit set would read as negative
    return "\x02" . der_len(strlen($bin)) . $bin;
}

function jwk_to_pem(array $jwk): string {
    if (($jwk['kty'] ?? '') !== 'RSA') throw new RuntimeException('Unsupported key type.');
    $seq    = der_uint(b64url_decode((string)$jwk['n'])) . der_uint(b64url_decode((string)$jwk['e']));
    $rsaPub = "\x30" . der_len(strlen($seq)) . $seq;
    $bits   = "\x03" . der_len(strlen($rsaPub) + 1) . "\x00" . $rsaPub;
    $algId  = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";  // rsaEncryption, NULL params
    $spki   = "\x30" . der_len(strlen($algId . $bits)) . $algId . $bits;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

/* Returns the token's claims, or throws. Never returns on a bad token. */
function google_verify_id_token(string $jwt, string $clientId, ?array $jwksOverride = null): array {
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) throw new RuntimeException('Not a JWT.');
    [$h64, $p64, $s64] = $parts;

    $header = json_decode(b64url_decode($h64), true);
    $claims = json_decode(b64url_decode($p64), true);
    if (!is_array($header) || !is_array($claims)) throw new RuntimeException('Unreadable token.');

    // "alg": "none" and HMAC confusion are the classic JWT bypasses.
    if (($header['alg'] ?? '') !== 'RS256') throw new RuntimeException('Unexpected signing algorithm.');
    $kid = (string)($header['kid'] ?? '');
    if ($kid === '') throw new RuntimeException('Token names no signing key.');

    $signed = $h64 . '.' . $p64;
    $sig    = b64url_decode($s64);

    $verified = false;
    // On an unknown kid, refetch once: Google rotates keys and our cache may be stale.
    foreach ([false, true] as $force) {
        $jwks = $jwksOverride ?? google_jwks($force);
        foreach ($jwks['keys'] as $jwk) {
            if (($jwk['kid'] ?? '') !== $kid) continue;
            $ok = openssl_verify($signed, $sig, jwk_to_pem($jwk), OPENSSL_ALGO_SHA256);
            if ($ok === 1) { $verified = true; }
            break 2;
        }
        if ($jwksOverride !== null) break;
    }
    if (!$verified) throw new RuntimeException('Signature did not verify.');

    if (!in_array((string)($claims['iss'] ?? ''), GOOGLE_ISSUERS, true)) {
        throw new RuntimeException('Token was not issued by Google.');
    }
    // Without this, a token minted for any other Google app would be accepted here.
    if (!hash_equals($clientId, (string)($claims['aud'] ?? ''))) {
        throw new RuntimeException('Token was issued for a different application.');
    }
    $now = time();
    if (($claims['exp'] ?? 0) < $now - CLOCK_SKEW)  throw new RuntimeException('Token has expired.');
    if (($claims['iat'] ?? 0) > $now + CLOCK_SKEW)  throw new RuntimeException('Token is dated in the future.');

    $verifiedEmail = $claims['email_verified'] ?? false;
    if ($verifiedEmail !== true && $verifiedEmail !== 'true') {
        throw new RuntimeException('That Google account has no verified email address.');
    }
    if (trim((string)($claims['email'] ?? '')) === '') throw new RuntimeException('Token carries no email address.');

    return $claims;
}
