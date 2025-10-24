import {
  LEGACY_STATE_FILE,
  LOOP_INTERVAL_MS,
  STATE_DB_FILE,
  TREASURY_ADDRESS
} from "./config.js";
import { StateStore } from "./state/stateStore.js";
import { publicClient } from "./treasuryClient.js";
import { collectNewTaxProceeds } from "./services/taxCollector.js";
import { reconcileListings } from "./services/listingMonitor.js";
import { performBuybackAndBurn } from "./services/buyback.js";
import { attemptPurchaseAndListing } from "./services/purchase.js";
import { logger } from "./utils/logger.js";
import { delay } from "./utils/time.js";

async function main(): Promise<void> {
  logger.info({ treasury: TREASURY_ADDRESS }, "Starting treasury bot");

  const latestBlock = await publicClient.getBlockNumber();
  const stateStore = new StateStore(STATE_DB_FILE, LEGACY_STATE_FILE);
  await stateStore.load(latestBlock);

  const initialState = stateStore.getState();
  logger.info(
    {
      commissionPoolWei: initialState.commissionPoolWei.toString(),
      salePoolWei: initialState.salePoolWei.toString(),
      lastTaxBlock: initialState.lastTaxBlock.toString()
    },
    "Loaded bot state"
  );

  for (;;) {
    const loopStart = Date.now();
    try {
      await collectNewTaxProceeds(stateStore);
      const proceedsCaptured = await reconcileListings(stateStore);
      if (proceedsCaptured > 0n) {
        logger.info(
          {
            proceedsWei: proceedsCaptured.toString(),
            salePoolWei: stateStore.getState().salePoolWei.toString()
          },
          "Captured NFT sale proceeds"
        );
      }

      let actionPerformed = await performBuybackAndBurn(stateStore);
      if (!actionPerformed) {
        actionPerformed = await attemptPurchaseAndListing(stateStore);
      }
    } catch (error) {
      const errPayload =
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { value: String(error) };
      logger.error({ err: errPayload }, "Bot loop iteration failed");
    }

    const elapsed = Date.now() - loopStart;
    const sleepFor = Math.max(0, LOOP_INTERVAL_MS - elapsed);
    if (sleepFor > 0) {
      await delay(sleepFor);
    }
  }
}

main().catch((error: unknown) => {
  const errPayload =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { value: String(error) };

  logger.error({ err: errPayload }, "Bot failed");
  process.exitCode = 1;
});
