import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Device tokens are 256 random bits, so a fast hash is enough: there is no
 * dictionary to guess from (slow hashes like bcrypt exist for human-chosen
 * passwords). Storing only the hash means a leaked database can't be used to
 * impersonate anyone's agent.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newDeviceToken(): string {
  return `aloe_${randomBytes(32).toString("base64url")}`;
}

/** Compare secrets in constant time, so response timing leaks nothing about how close a guess was. */
export function secretsMatch(given: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest());
}

/** "Bearer abc" -> "abc"; anything else -> null. */
export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}
