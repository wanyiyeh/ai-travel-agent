import { describe, expect, it } from "vitest";
import { isAdminEmail, parseEmailList } from "./adminEmails";

describe("parseEmailList", () => {
  it("splits, trims, lowercases and drops empties and stray quotes", () => {
    expect([...parseEmailList(' "A@x.com" , b@Y.com,, ')]).toEqual(["a@x.com", "b@y.com"]);
  });

  it("is empty when unset", () => {
    expect(parseEmailList(undefined).size).toBe(0);
  });
});

describe("isAdminEmail", () => {
  it("matches case-insensitively", () => {
    expect(isAdminEmail("Me@Gmail.com", "me@gmail.com")).toBe(true);
  });

  it("rejects anyone not listed, and everyone when the list is empty", () => {
    expect(isAdminEmail("other@gmail.com", "me@gmail.com")).toBe(false);
    expect(isAdminEmail("me@gmail.com", "")).toBe(false);
  });
});
