import { describe, expect, test } from "vitest";
import { ADDRESSES } from "@/config/contracts";
import { fetchTrigger, waitForDecision, waitForOutcome } from "./tracker";

// Reads the public testnet RPCs, so it only runs on request: LIVE=1 pnpm test
const SAMPLE_TX = "0x5be4c13e8e82050dabd132dcd60fd3e75b2803c409958a87f03175eacf0a3a46";
const SAMPLE_LASNA_BLOCK = 8402587n;

describe.runIf(process.env.LIVE === "1")("loop tracker against benchmark sample 1", () => {
  test("follows the swap to its decision and its outcome with the published latency", async () => {
    const signal = new AbortController().signal;

    const trigger = await fetchTrigger(SAMPLE_TX, ADDRESSES.poolB);
    const historical = { ...trigger, lasnaFromBlock: SAMPLE_LASNA_BLOCK - 5n };
    const window = { lasnaToBlock: SAMPLE_LASNA_BLOCK + 5n, baseToBlock: trigger.blockNumber + 100n };
    const decision = await waitForDecision(historical, signal, window);
    const outcome = await waitForOutcome(historical, signal, window);

    expect(trigger.opportunityId).toBe("0xcee1191920242a548d62b1f4e561db63e135de5dceeb6b9317f91b8d60ef6e39");
    expect(trigger.blockNumber).toBe(59089529n);
    expect(decision?.decision).toBe("CallbackRequested");
    expect(decision?.quotedOut).toBe(1_007_142_010n);
    expect(outcome?.outcome).toBe("Executed");
    expect(outcome?.latencyMs).toBe(1800);
  }, 60_000);
});
