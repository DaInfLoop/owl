import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const newReplyKey = () => randomBytes(32).toString("hex");
export const hashReplyKey = (key: string, userId: string) =>
  createHash("sha256").update(`${key}:${userId}`).digest("hex");

export function hashAuthor(userId: string, salt: string) {
  return createHash("sha256").update(`${salt}:${userId}`).digest("hex");
}
export function authorCredential(userId: string) {
  const authorSalt = randomBytes(32).toString("hex");
  return { authorSalt, authorHash: hashAuthor(userId, authorSalt) };
}
export function matchesHash(actual: string, expected: string) {
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}
export function ownsPost(
  post: { authorSalt: string | null; authorHash: string | null; replyKeyHash: string | null },
  userId: string,
  key: string,
) {
  if (post.authorSalt && post.authorHash) {
    return matchesHash(hashAuthor(userId, post.authorSalt), post.authorHash);
  }
  return !!key && !!post.replyKeyHash && matchesHash(hashReplyKey(key, userId), post.replyKeyHash);
}
