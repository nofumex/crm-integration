import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION = "v1";

export function encryptSession(plaintext: string, masterKey: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(masterKey, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, salt, iv, tag, ciphertext].map((value) => typeof value === "string" ? value : value.toString("base64url")).join(".");
}

export function decryptSession(encrypted: string, masterKey: string): string {
  const [version, saltRaw, ivRaw, tagRaw, ciphertextRaw] = encrypted.split(".");
  if (version !== VERSION || !saltRaw || !ivRaw || !tagRaw || !ciphertextRaw) throw new Error("Invalid encrypted session format");
  const key = scryptSync(masterKey, Buffer.from(saltRaw, "base64url"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, "base64url")), decipher.final()]).toString("utf8");
}
