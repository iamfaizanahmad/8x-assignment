import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const key = () => {
  const k = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
};

/** AES-256-GCM; output is iv.tag.ciphertext (base64url). */
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(token: string) {
  const [iv, tag, data] = token.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
