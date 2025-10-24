import { publicClient } from "../treasuryClient.js";
import { StateStore } from "../state/stateStore.js";
import { logger } from "../utils/logger.js";
import { TREASURY_ADDRESS, MAX_LISTING_CHECKS_PER_TICK } from "../config.js";
import type { ActiveListingState } from "../types.js";

const ERC721_OWNER_OF_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }]
  }
] as const;

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

export async function reconcileListings(stateStore: StateStore): Promise<bigint> {
  const state = stateStore.getState();
  if (state.activeListings.length === 0) {
    return 0n;
  }

  const updatedListings: ActiveListingState[] = [];
  let checked = 0;
  let proceedsCaptured = 0n;
  const treasuryLower = TREASURY_ADDRESS.toLowerCase();

  for (const listing of state.activeListings) {
    if (checked >= MAX_LISTING_CHECKS_PER_TICK) {
      updatedListings.push(listing);
      continue;
    }
    checked += 1;

    try {
      if (listing.tokenStandard === "erc1155") {
        const rawBalance = await publicClient.readContract({
          address: listing.collection,
          abi: ERC1155_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [TREASURY_ADDRESS, BigInt(listing.tokenId)]
        });
        if (typeof rawBalance !== "bigint") {
          throw new Error("Unexpected balanceOf return type");
        }
        const balance = rawBalance;

        const targetBalance =
          listing.expectedPostSaleBalance !== null
            ? listing.expectedPostSaleBalance
            : 0n;

        if (balance > targetBalance) {
          updatedListings.push(listing);
          continue;
        }
      } else {
        const rawOwner = await publicClient.readContract({
          address: listing.collection,
          abi: ERC721_OWNER_OF_ABI,
          functionName: "ownerOf",
          args: [BigInt(listing.tokenId)]
        });
        if (typeof rawOwner !== "string") {
          throw new Error("Unexpected ownerOf return type");
        }
        const currentOwner = rawOwner;

        if (currentOwner.toLowerCase() === treasuryLower) {
          updatedListings.push(listing);
          continue;
        }
      }

      proceedsCaptured += listing.expectedProceedsWei;
      logger.info(
        {
          orderHash: listing.orderHash,
          collection: listing.collection,
          tokenId: listing.tokenId,
          amountWei: listing.expectedProceedsWei.toString(),
          tokenStandard: listing.tokenStandard,
          listedQuantity: listing.listedQuantity.toString()
        },
        "Detected NFT sale"
      );
    } catch (error) {
      logger.warn(
        {
          orderHash: listing.orderHash,
          collection: listing.collection,
          tokenId: listing.tokenId,
          err: error instanceof Error ? error.message : String(error)
        },
        "Failed to verify NFT ownership; keeping listing for next iteration"
      );
      updatedListings.push(listing);
      continue;
    }
  }

  state.activeListings = updatedListings;
  if (proceedsCaptured > 0n) {
    state.salePoolWei += proceedsCaptured;
    await stateStore.save();
  }
  return proceedsCaptured;
}
