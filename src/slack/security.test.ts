import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  authorCredential,
  hashAuthor,
  hashReplyKey,
  matchesHash,
  newReplyKey,
  ownsPost,
} from "./security.js";

const user = "U123";
const otherUser = "U456";
const key = "reply-secret";
const legacyPost = () => ({
  authorSalt: null,
  authorHash: null,
  replyKeyHash: hashReplyKey(key, user),
});

describe("ownership", () => {
  test("account credentials authorize the author without a reply key", () => {
    const post = { ...authorCredential(user), replyKeyHash: null };
    expect(ownsPost(post, user, "")).toBe(true);
    expect(ownsPost(post, user, "unrelated-key")).toBe(true);
    expect(ownsPost(post, otherUser, "")).toBe(false);
  });

  test("account credentials take precedence over a matching legacy key", () => {
    const post = { ...authorCredential(user), replyKeyHash: hashReplyKey(key, otherUser) };
    expect(ownsPost(post, otherUser, key)).toBe(false);
    expect(ownsPost(post, user, key)).toBe(true);
  });

  test("legacy ownership requires both the correct key and account", () => {
    expect(ownsPost(legacyPost(), user, key)).toBe(true);
    expect(ownsPost(legacyPost(), user, "wrong-key")).toBe(false);
    expect(ownsPost(legacyPost(), otherUser, key)).toBe(false);
    expect(ownsPost(legacyPost(), user, "")).toBe(false);
    expect(ownsPost({ ...legacyPost(), replyKeyHash: null }, user, key)).toBe(false);
    expect(ownsPost({ authorSalt: null, authorHash: null, replyKeyHash: null }, user, key)).toBe(
      false,
    );
  });

  test("incomplete account credentials fall back to legacy ownership", () => {
    expect(ownsPost({ ...legacyPost(), authorSalt: "salt" }, user, key)).toBe(true);
    expect(ownsPost({ ...legacyPost(), authorHash: hashAuthor(user, "salt") }, user, key)).toBe(
      true,
    );
  });

  test.each(["", "not-hex", "ab", "a".repeat(63), "a".repeat(66), "gg".repeat(32)])(
    "malformed stored hash %j denies ownership without throwing",
    (hash) => {
      expect(ownsPost({ ...legacyPost(), replyKeyHash: hash }, user, key)).toBe(false);
      expect(
        ownsPost({ authorSalt: "salt", authorHash: hash, replyKeyHash: null }, user, key),
      ).toBe(false);
    },
  );
});

describe("hashes and credentials", () => {
  test("hashes use the expected SHA-256 inputs and are account/salt specific", () => {
    const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(hashReplyKey(key, user)).toBe(sha256(`${key}:${user}`));
    expect(hashAuthor(user, "salt")).toBe(sha256(`salt:${user}`));
    expect(hashReplyKey(key, user)).not.toBe(hashReplyKey(key, otherUser));
    expect(hashReplyKey(key, user)).not.toBe(hashReplyKey("other-key", user));
    expect(hashAuthor(user, "salt")).not.toBe(hashAuthor(otherUser, "salt"));
    expect(hashAuthor(user, "salt")).not.toBe(hashAuthor(user, "other-salt"));
  });

  test("new keys and author salts are independent 32-byte hex secrets", () => {
    const firstKey = newReplyKey();
    const secondKey = newReplyKey();
    const first = authorCredential(user);
    const second = authorCredential(user);
    for (const value of [
      firstKey,
      secondKey,
      first.authorSalt,
      second.authorSalt,
      first.authorHash,
    ]) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(firstKey).not.toBe(secondKey);
    expect(first.authorSalt).not.toBe(second.authorSalt);
    expect(first.authorHash).not.toBe(second.authorHash);
    expect(first.authorHash).toBe(hashAuthor(user, first.authorSalt));
    expect(second.authorHash).toBe(hashAuthor(user, second.authorSalt));
  });

  test("hash comparison accepts matching digest bytes and rejects mismatches", () => {
    const hash = hashReplyKey(key, user);
    expect(matchesHash(hash, hash)).toBe(true);
    expect(matchesHash(hash, hash.toUpperCase())).toBe(true);
    expect(matchesHash(hash, hashReplyKey(key, otherUser))).toBe(false);
  });

  test.each(["", "xyz", "ab", "a".repeat(63), "a".repeat(66), "gg".repeat(32)])(
    "hash comparison rejects malformed digest %j on either side",
    (malformed) => {
      const hash = hashReplyKey(key, user);
      expect(matchesHash(malformed, hash)).toBe(false);
      expect(matchesHash(hash, malformed)).toBe(false);
      expect(matchesHash(malformed, malformed)).toBe(false);
    },
  );
});
