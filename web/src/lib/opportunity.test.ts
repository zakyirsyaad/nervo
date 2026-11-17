import { describe, expect, test } from "vitest";
import { opportunityId } from "./opportunity";

describe("opportunityId", () => {
  test("matches the id the Reactive contract recorded for benchmark sample 1", () => {
    const id = opportunityId({
      chainId: 84532,
      pool: "0xf68dE754214b013c206AFD5753b9f26428C29228",
      txHash: "0x5be4c13e8e82050dabd132dcd60fd3e75b2803c409958a87f03175eacf0a3a46",
      logIndex: 29,
    });

    expect(id).toBe("0xcee1191920242a548d62b1f4e561db63e135de5dceeb6b9317f91b8d60ef6e39");
  });
});
