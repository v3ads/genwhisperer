import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt, maskApiKey } from "./crypto.js";

beforeAll(() => {
  process.env.ENCRYPTION_SECRET = "a8f3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1";
});

describe("AES-256-GCM encrypt/decrypt", () => {
  it("encrypts and decrypts a string correctly", () => {
    const plaintext = "sk-or-v1-supersecretapikey";
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.split(":")).toHaveLength(3);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const key = "sk-or-v1-test";
    expect(encrypt(key)).not.toBe(encrypt(key));
  });

  it("throws on tampered ciphertext", () => {
    const ciphertext = encrypt("test");
    const parts = ciphertext.split(":");
    parts[2] = "deadbeef";
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});

describe("maskApiKey", () => {
  it("masks the middle of a key", () => {
    expect(maskApiKey("sk-or-v1-abcdefghijklmnop")).toBe("sk-or-v1****mnop");
  });

  it("handles short keys", () => {
    expect(maskApiKey("short")).toBe("****");
  });
});
