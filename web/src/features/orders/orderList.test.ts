import { describe, expect, test } from "vitest";
import type { Address, Hex } from "viem";
import {
  canCancel,
  mergeOrderRefs,
  orderCacheKey,
  parseOrderCache,
  serializeOrderCache,
  toOrderView,
  type OrderDetails,
  type OrderRef,
} from "./orderList";

const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const OTHER: Address = "0x00000000000000000000000000000000000000b2";
const WETH: Address = "0x0f70a79D1a0DFCB61005AF03084d3bED0e71E932";
const USDC: Address = "0x29583A3d63FD02f1bE462d4b6A1B1BeCeFcaFB87";
const TOKENS = { weth: WETH, usdc: USDC };

function ref(id: bigint, blockNumber = 100n + id): OrderRef {
  const txHash = `0x${id.toString(16).padStart(64, "0")}` as Hex;
  return { id, txHash, blockNumber };
}

const details: OrderDetails = {
  owner: OWNER,
  expiry: 2_000n,
  condition: 0,
  status: 1,
  tokenIn: WETH.toLowerCase() as Address,
  amountIn: 10n ** 18n,
  triggerPrice: 2_970_000_000n,
  minAmountOut: 2_900_000_000n,
};

describe("mergeOrderRefs", () => {
  test("keeps one entry per order id, newest order first", () => {
    const merged = mergeOrderRefs([ref(1n), ref(3n)], [ref(2n), ref(3n)]);

    expect(merged.map((entry) => entry.id)).toEqual([3n, 2n, 1n]);
  });

  test("does not change the lists it is given", () => {
    const cached = [ref(1n)];
    const scanned = [ref(2n)];

    mergeOrderRefs(cached, scanned);

    expect(cached).toEqual([ref(1n)]);
    expect(scanned).toEqual([ref(2n)]);
  });
});

describe("order cache", () => {
  test("round-trips through JSON", () => {
    const cache = { scannedTo: 68_000_000n, refs: [ref(2n), ref(1n)] };

    expect(parseOrderCache(serializeOrderCache(cache))).toEqual(cache);
  });

  test("reads missing, broken or foreign data as an empty cache", () => {
    const empty = { scannedTo: undefined, refs: [] };

    expect(parseOrderCache(null)).toEqual(empty);
    expect(parseOrderCache("{not json")).toEqual(empty);
    expect(parseOrderCache('"hello"')).toEqual(empty);
    expect(parseOrderCache('{"v":2,"refs":[]}')).toEqual(empty);
  });

  test("skips malformed entries but keeps the valid ones", () => {
    const raw = JSON.stringify({
      v: 1,
      scannedTo: "abc",
      refs: [
        { id: "7", txHash: ref(7n).txHash, blockNumber: "107" },
        { id: "-1", txHash: ref(1n).txHash, blockNumber: "1" },
        { id: "8", txHash: "0x1234", blockNumber: "108" },
        { id: "9" },
      ],
    });

    expect(parseOrderCache(raw)).toEqual({ scannedTo: undefined, refs: [ref(7n)] });
  });

  test("keys the cache by chain, order book and owner, ignoring address case", () => {
    expect(orderCacheKey(1301, "0xABC0000000000000000000000000000000000001", OWNER)).toBe(
      orderCacheKey(1301, "0xabc0000000000000000000000000000000000001", OWNER.toUpperCase().replace("0X", "0x") as Address),
    );
  });
});

describe("toOrderView", () => {
  test("names the order and its token from the stored fields", () => {
    const view = toOrderView(ref(4n), details, 1_000n, TOKENS);

    expect(view).toMatchObject({ kind: "stop-loss", tokenIn: "weth", status: "Open", isExpired: false, amountIn: 10n ** 18n });
  });

  test("marks an open order past its expiry, judged by chain time", () => {
    expect(toOrderView(ref(4n), details, 2_001n, TOKENS).isExpired).toBe(true);
    expect(toOrderView(ref(4n), details, 2_000n, TOKENS).isExpired).toBe(false);
  });

  test("reads a USDC limit buy and an unknown status", () => {
    const view = toOrderView(ref(5n), { ...details, tokenIn: USDC, status: 9 }, 1_000n, TOKENS);

    expect(view.kind).toBe("limit-buy");
    expect(view.status).toBe("None");
  });
});

describe("canCancel", () => {
  test("allows only the owner to cancel an open order", () => {
    const view = toOrderView(ref(4n), details, 1_000n, TOKENS);

    expect(canCancel(view, OWNER)).toBe(true);
    expect(canCancel(view, OWNER.toUpperCase().replace("0X", "0x") as Address)).toBe(true);
    expect(canCancel(view, OTHER)).toBe(false);
    expect(canCancel(view, undefined)).toBe(false);
    expect(canCancel({ ...view, status: "Filled" }, OWNER)).toBe(false);
  });
});
