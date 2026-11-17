"use client";

import { useState } from "react";
import { LoopTimeline } from "./LoopTimeline";
import { MarketPanel } from "./MarketPanel";
import { SwapPanel } from "./SwapPanel";
import { useLoop, type TrackedSwap } from "./useLoop";
import { usePools } from "./usePools";
import { useWallet } from "./useWallet";
import styles from "./trade.module.css";

export function TradeWorkspace() {
  const [trackedSwap, setTrackedSwap] = useState<TrackedSwap>();
  const { pools, isError } = usePools();
  const wallet = useWallet();
  const loop = useLoop(trackedSwap);

  return (
    <div className={`container ${styles.workspace}`}>
      <div className={styles.left}>
        <SwapPanel
          pools={pools}
          wallet={wallet}
          isLoopPending={Boolean(trackedSwap) && !loop.status.isFinal}
          onSwapped={setTrackedSwap}
        />
      </div>
      <div className={styles.right}>
        <MarketPanel pools={pools} isError={isError} />
        <LoopTimeline loop={loop} hasSwap={Boolean(trackedSwap)} />
      </div>
    </div>
  );
}
