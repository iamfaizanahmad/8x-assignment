import "server-only";
import { createHash } from "crypto";

/** Salted hash of the caller's IP: enough to rate-limit anonymous visitors without storing the address. */
export function visitorHash(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${process.env.TOKEN_ENCRYPTION_KEY}:${ip}`).digest("hex").slice(0, 32);
}
