"use client";

import { useEffect, useRef, useState } from "react";
import { revealIfOffscreen } from "@/lib/reveal";
import { LoopTimeline } from "./LoopTimeline";
import { MarketPanel } from "./MarketPanel";
import { PoolHistory } from "./PoolHistory";
import { SwapPanel } from "./SwapPanel";
import { useLoop, type TrackedSwap } from "./useLoop";
import { usePools } from "./usePools";
import { useWallet } from "./useWallet";
import styles from "./trade.module.css";

export function TradeWorkspace() {
  const [trackedSwap, setTrackedSwap] = useState<TrackedSwap>();
  const timelineRef = useRef<HTMLDivElement>(null);
  const { pools, isError } = usePools();
  const wallet = useWallet();
  const loop = useLoop(trackedSwap);

  // After the commit, so the timeline is measured where the new swap's layout puts it.
  useEffect(() => {
    if (trackedSwap) revealIfOffscreen(timelineRef.current);
  }, [trackedSwap]);

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
        <div ref={timelineRef} className={styles.reveal}>
          <LoopTimeline loop={loop} hasSwap={Boolean(trackedSwap)} />
        </div>
      </div>
      <PoolHistory pools={pools} account={wallet.account} />
    </div>
  );
}
