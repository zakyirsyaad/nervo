#!/bin/sh
# Prepare the comparison: seed the unfiltered stack's pools, then top up lREACT on both Reactive contracts.
# Three transactions, each one asks for the `deployer` keystore password.
set -eu
DEPLOYER=0x578B13A1e2113075fb07f1b9955c642D6b390e08
SYSTEM=0x8888888888888888888888888888888888888888
. ./.env

POOL_A="$BASELINE_POOL_A" POOL_B="$BASELINE_POOL_B" EXECUTOR="$BASELINE_EXECUTOR" \
  forge script script/Scenario.s.sol --sig "seed()" --rpc-url base_sepolia \
  --account deployer --sender "$DEPLOYER" --broadcast

cast send "$SYSTEM" "depositTo(address)" "$REACTIVE" --value 0.25ether --rpc-url lasna --account deployer
cast send "$SYSTEM" "depositTo(address)" "$BASELINE_REACTIVE" --value 0.2ether --rpc-url lasna --account deployer
echo "DONE"
