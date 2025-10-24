import { LOG_FETCH_THROTTLE_MS, TREASURY_ADDRESS, TOKEN_ADDRESS } from "../config.js";
import { StateStore } from "../state/stateStore.js";
import { publicClient } from "../treasuryClient.js";
import { logger } from "../utils/logger.js";
import { delay } from "../utils/time.js";

const WALLET_TAX_SENT_EVENT = {
  type: "event",
  name: "WalletTaxSent",
  inputs: [
    { name: "id", type: "uint8", indexed: true },
    { name: "recipient", type: "address", indexed: false },
    { name: "amount", type: "uint256", indexed: false }
  ]
} as const;

const MAX_LOG_SPAN = 10n;

export async function collectNewTaxProceeds(stateStore: StateStore): Promise<boolean> {
  if (!TOKEN_ADDRESS) {
    return false;
  }

  const state = stateStore.getState();
  const latestBlock = await publicClient.getBlockNumber();

  if (state.lastTaxBlock === 0n) {
    state.lastTaxBlock = latestBlock;
    await stateStore.save();
    return false;
  }

  if (state.lastTaxBlock >= latestBlock) {
    return false;
  }

  const startBlock = state.lastTaxBlock + 1n;
  let cursor = startBlock;
  let totalCollected = 0n;
  const treasuryLower = TREASURY_ADDRESS.toLowerCase();

  while (cursor <= latestBlock) {
    const rangeEnd = cursor + (MAX_LOG_SPAN - 1n);
    const toBlock = rangeEnd > latestBlock ? latestBlock : rangeEnd;

    const logs = await publicClient.getLogs({
      address: TOKEN_ADDRESS,
      event: WALLET_TAX_SENT_EVENT,
      fromBlock: cursor,
      toBlock
    });

    for (const log of logs) {
      const recipient = log.args?.recipient;
      if (typeof recipient !== "string" || recipient.toLowerCase() !== treasuryLower) {
        continue;
      }
      const amount = log.args?.amount;
      if (typeof amount === "bigint" && amount > 0n) {
        totalCollected += amount;
      }
    }

    cursor = toBlock + 1n;

    if (cursor <= latestBlock && LOG_FETCH_THROTTLE_MS > 0) {
      await delay(LOG_FETCH_THROTTLE_MS);
    }
  }

  state.lastTaxBlock = latestBlock;
  if (totalCollected > 0n) {
    state.commissionPoolWei += totalCollected;
    await stateStore.save();
    logger.info(
      {
        amountWei: totalCollected.toString(),
        totalCommissionPool: state.commissionPoolWei.toString(),
        fromBlock: startBlock.toString(),
        toBlock: latestBlock.toString()
      },
      "Captured new tax proceeds"
    );
    return true;
  }

  await stateStore.save();
  return false;
}
