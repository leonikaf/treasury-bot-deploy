import {
  CHAIN_ID,
  OPENSEA_API_KEY,
  OPENSEA_API_URL,
  TARGET_COLLECTION,
  TARGET_COLLECTION_SLUG,
  TARGET_TOKEN_ID,
  TREASURY_ADDRESS,
  ACTION_COOLDOWN_MS
} from "../config.js";
import { fetchOpenSeaBuyExecution } from "../marketplaces/opensea.js";
import { createOpenSeaListing } from "../marketplaces/openseaListings.js";
import { StateStore } from "../state/stateStore.js";
import { executeSeaport, operatorAccount, publicClient, waitForReceipt } from "../treasuryClient.js";
import { logger } from "../utils/logger.js";
import { delay } from "../utils/time.js";
import type { ExecutionPayload, TokenStandard } from "../types.js";

const ERC1155_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

export async function attemptPurchaseAndListing(stateStore: StateStore): Promise<boolean> {
  if (!TARGET_COLLECTION && !TARGET_COLLECTION_SLUG) {
    return false;
  }

  if (TARGET_TOKEN_ID && !TARGET_COLLECTION) {
    logger.error("TARGET_COLLECTION must be provided when TARGET_TOKEN_ID is set.");
    return false;
  }

  const state = stateStore.getState();
  if (state.commissionPoolWei <= 0n) {
    return false;
  }

  let execution: ExecutionPayload;
  try {
    execution = await fetchOpenSeaBuyExecution(
      {
        apiUrl: OPENSEA_API_URL,
        apiKey: OPENSEA_API_KEY,
        chainId: CHAIN_ID ?? 8453,
        taker: TREASURY_ADDRESS
      },
      {
        collection: TARGET_COLLECTION,
        collectionSlug: TARGET_COLLECTION_SLUG,
        tokenId: TARGET_TOKEN_ID
      }
    );
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "Failed to resolve OpenSea execution; skipping iteration"
    );
    return false;
  }

  const cost = execution.valueWei;
  if (cost <= 0n || state.commissionPoolWei < cost) {
    return false;
  }

  const purchaseTx = await executeSeaport({
    router: execution.router,
    valueWei: cost,
    calldata: execution.calldata,
    callValueWei: 0n
  });
  logger.info(
    { txHash: purchaseTx, costWei: cost.toString() },
    "Submitted NFT purchase transaction"
  );
  await waitForReceipt(purchaseTx);

  state.commissionPoolWei -= cost;
  await stateStore.save();

  if (!execution.openSeaMetadata) {
    logger.warn("Missing OpenSea metadata; skipping relist step");
    if (ACTION_COOLDOWN_MS > 0) {
      await delay(ACTION_COOLDOWN_MS);
    }
    return true;
  }

  try {
    const listing = await createOpenSeaListing(
      {
        apiUrl: OPENSEA_API_URL,
        apiKey: OPENSEA_API_KEY,
        chainId: CHAIN_ID ?? 8453,
        taker: operatorAccount.address
      },
      execution.openSeaMetadata,
      {
        executionPriceWei: cost
      }
    );

    if (!listing) {
      logger.warn("Listing creation returned null; leaving NFT unlisted");
    } else {
      const tokenId = execution.openSeaMetadata.offerIdentifier.toString();
      const offerItemType = execution.openSeaMetadata.offerItemType;
      const tokenStandard: TokenStandard = offerItemType === 3 ? "erc1155" : "erc721";
      const listedQuantityRaw =
        execution.openSeaMetadata.offerEndAmount > 0n
          ? execution.openSeaMetadata.offerEndAmount
          : execution.openSeaMetadata.offerStartAmount > 0n
            ? execution.openSeaMetadata.offerStartAmount
            : 1n;
      const listedQuantity =
        tokenStandard === "erc1155"
          ? 1n
          : listedQuantityRaw > 0n
            ? listedQuantityRaw
            : 1n;

      let expectedPostSaleBalance: bigint | null = null;
      if (tokenStandard === "erc1155") {
        try {
          const rawBalance = await publicClient.readContract({
            address: execution.openSeaMetadata.offerToken,
            abi: ERC1155_BALANCE_OF_ABI,
            functionName: "balanceOf",
            args: [TREASURY_ADDRESS, execution.openSeaMetadata.offerIdentifier]
          });
          if (typeof rawBalance !== "bigint") {
            throw new Error("Unexpected balanceOf return type");
          }
          const currentBalance = rawBalance;
          expectedPostSaleBalance =
            currentBalance > listedQuantity ? currentBalance - listedQuantity : 0n;
        } catch (balanceError) {
          logger.warn(
            {
              collection: execution.openSeaMetadata.offerToken,
              tokenId,
              err: balanceError instanceof Error ? balanceError.message : String(balanceError)
            },
            "Failed to inspect ERC1155 balance before listing; assuming zero post-sale balance"
          );
          expectedPostSaleBalance = 0n;
        }
      }

      state.activeListings.push({
        orderHash: listing.orderHash,
        collection: execution.openSeaMetadata.offerToken,
        tokenId,
        expectedProceedsWei: listing.sellerProceedsWei,
        listedAtMs: Date.now(),
        tokenStandard,
        listedQuantity,
        expectedPostSaleBalance
      });
      await stateStore.save();
      logger.info(
        {
          orderHash: listing.orderHash,
          expectedProceedsWei: listing.sellerProceedsWei.toString(),
          tokenId,
          collection: execution.openSeaMetadata.offerToken,
          tokenStandard,
          listedQuantity: listedQuantity.toString()
        },
        "Successfully created OpenSea listing"
      );
    }
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Failed to create OpenSea listing"
    );
  }

  if (ACTION_COOLDOWN_MS > 0) {
    await delay(ACTION_COOLDOWN_MS);
  }

  return true;
}
