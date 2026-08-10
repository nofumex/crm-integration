import { describe, expect, it } from "vitest";
import { decryptSession, encryptSession } from "../src/security/session-crypto.js";

describe("Telegram session encryption", () => {
  it("round-trips and rejects a wrong key", () => {
    const encrypted = encryptSession("telegram-session-secret", "long-master-key");
    expect(encrypted).not.toContain("telegram-session-secret");
    expect(decryptSession(encrypted, "long-master-key")).toBe("telegram-session-secret");
    expect(() => decryptSession(encrypted, "wrong-key")).toThrow();
  });
});
