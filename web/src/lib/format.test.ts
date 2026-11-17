import { describe, expect, test } from "vitest";
import { formatAmount, formatMs, formatPercent, formatSeconds, parseAmount, shortHex } from "./format";

describe("formatAmount", () => {
  test("groups thousands and keeps the requested decimals", () => {
    expect(formatAmount(3_060_200_000n, 6, 2)).toBe("3,060.20");
    expect(formatAmount(987_100_000_000_000_000n, 18, 4)).toBe("0.9871");
    expect(formatAmount(0n, 6, 2)).toBe("0.00");
  });

  test("truncates instead of rounding up so a balance is never overstated", () => {
    expect(formatAmount(1_999_999n, 6, 2)).toBe("1.99");
  });
});

describe("parseAmount", () => {
  test("parses plain and comma-grouped input", () => {
    expect(parseAmount("3,000", 6)).toBe(3_000_000_000n);
    expect(parseAmount("0.5", 18)).toBe(500_000_000_000_000_000n);
    expect(parseAmount("1,234,567.5", 6)).toBe(1_234_567_500_000n);
  });

  test("accepts a leading decimal point", () => {
    expect(parseAmount(".5", 6)).toBe(500_000n);
  });

  test("rejects commas that are not thousands separators, so 1,5 is never read as 15", () => {
    expect(parseAmount("1,5", 6)).toBeNull();
    expect(parseAmount("3,00", 6)).toBeNull();
    expect(parseAmount("1,2,3", 6)).toBeNull();
    expect(parseAmount("1234,567", 6)).toBeNull();
  });

  test("returns null for empty, malformed, negative or over-precise input", () => {
    expect(parseAmount("", 6)).toBeNull();
    expect(parseAmount("abc", 6)).toBeNull();
    expect(parseAmount("-1", 6)).toBeNull();
    expect(parseAmount("1.0000001", 6)).toBeNull();
    expect(parseAmount("1.2.3", 6)).toBeNull();
  });
});

describe("shortHex", () => {
  test("keeps the first six and last four characters", () => {
    expect(shortHex("0x5be4c13e8e82050dabd132dcd60fd3e75b2803c409958a87f03175eacf0a3a46")).toBe("0x5be4…3a46");
  });
});

describe("formatMs", () => {
  test("groups thousands and appends the unit", () => {
    expect(formatMs(1400)).toBe("1,400 ms");
  });
});

describe("formatPercent", () => {
  test("turns basis points into a signed percentage", () => {
    expect(formatPercent(775)).toBe("+7.75%");
    expect(formatPercent(-100)).toBe("-1.00%");
    expect(formatPercent(0)).toBe("0.00%");
  });
});

describe("formatSeconds", () => {
  test("shows milliseconds as seconds with one decimal", () => {
    expect(formatSeconds(1800)).toBe("1.8 seconds");
    expect(formatSeconds(1000)).toBe("1.0 seconds");
  });
});
