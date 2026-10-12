import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for model API keys at rest. ENCRYPTION_KEY is any long random
// string; it is hashed to 32 bytes so its format does not matter.
function key() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || k.length < 16) throw new Error("ENCRYPTION_KEY must be set (16+ chars)");
  return createHash("sha256").update(k).digest();
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decrypt(blob: string) {
  const [v, iv, tag, body] = blob.split(".");
  if (v !== "v1") throw new Error("unknown key format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
