import { expect, test } from "bun:test";

test("can we test?", () => {
  expect(1 + 1).toBe(2);
});

test("can we test async?", async () => {
  const result = await new Promise((resolve) => setTimeout(() => resolve(67), 100));
  expect(result).toBe(67);
});

// now the actual app testing
// it never happened
