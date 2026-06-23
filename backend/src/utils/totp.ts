import crypto from "node:crypto";

// RFC 6238 (TOTP) / RFC 4226 (HOTP) implemented with node:crypto — no external
// dependency. Secrets are base32 (RFC 4648), 6-digit codes, 30-second step,
// SHA-1 (the authenticator-app default).

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a random base32 secret (default 20 bytes → 32 chars). */
export function generateBase32Secret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/** Current TOTP code for a base32 secret. */
export function generateTotp(
  base32Secret: string,
  t = Date.now(),
  step = 30,
  digits = 6
): string {
  const counter = Math.floor(t / 1000 / step);
  return hotp(base32Decode(base32Secret), counter, digits);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify a submitted code against the secret, allowing ±`window` time steps to
 * tolerate clock drift (default ±1 step = ±30s).
 */
export function verifyTotp(
  base32Secret: string,
  token: string,
  t = Date.now(),
  step = 30,
  digits = 6,
  window = 1
): boolean {
  const code = (token ?? "").trim();
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(t / 1000 / step);
  const secret = base32Decode(base32Secret);
  for (let w = -window; w <= window; w++) {
    if (timingSafeEqualStr(hotp(secret, counter + w, digits), code)) return true;
  }
  return false;
}

/** otpauth:// URI an authenticator app can import (manually or via QR). */
export function otpauthUrl(
  base32Secret: string,
  account: string,
  issuer = "GoCampus"
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
