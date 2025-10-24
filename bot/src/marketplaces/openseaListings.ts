import { randomBytes } from "node:crypto";
import { bytesToHex, hexToBigInt } from "viem";
import type { OrderComponents } from "@opensea/seaport-js/lib/types.js";

import type {
  Address,
  OpenSeaListingBlueprint,
  OpenSeaListingConsiderationBlueprint,
  Hex
} from "../types.js";
import {
  executeSeaport,
  getSeaportCounter,
  publicClient,
  setCollectionApproval,
  treasuryAbi,
  waitForReceipt
} from "../treasuryClient.js";
import { TREASURY_ADDRESS } from "../config.js";
import { debugLog, type OpenSeaFetcherConfig } from "./opensea.js";
import { getSeaport } from "./openseaClients.js";

interface ListingOptions {
  readonly executionPriceWei: bigint;
  readonly markupBps: number;
  readonly listingDuration: number;
}

interface ListingResult {
  readonly orderHash: string;
  readonly sellerProceedsWei: bigint;
  readonly listingPriceWei: bigint;
}

const DEFAULT_MARKUP_BPS = 12000; // 120% (20% markup)
const BASIS_POINTS_DENOMINATOR = 10_000n;
const DEFAULT_LISTING_DURATION = 7 * 24 * 60 * 60; // 7 days
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;
const SEAPORT_CONDUIT_CONTROLLER: Address = "0x00000000F9490004C11Cef243f5400493c00Ad63";
const OWNERSHIP_PROPAGATION_DELAY_MS = 15_000;
const OWNERSHIP_CHECK_MAX_ATTEMPTS = 3;
const OWNERSHIP_CHECK_DELAY_MS = 15_000;
const ERC721_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }]
  }
] as const;

const ERC1155_ABI = [
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

const SEAPORT_ITEM_TYPE = {
  ERC721: 2,
  ERC1155: 3
} as const;

type SeaportItemType = (typeof SEAPORT_ITEM_TYPE)[keyof typeof SEAPORT_ITEM_TYPE];

const CONDUIT_CONTROLLER_ABI = [
  {
    type: "function",
    name: "getConduit",
    stateMutability: "view",
    inputs: [{ name: "conduitKey", type: "bytes32" }],
    outputs: [
      { name: "conduit", type: "address" },
      { name: "exists", type: "bool" }
    ]
  }
] as const;

const ERC721_APPROVAL_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
] as const;

export async function createOpenSeaListing(
  _config: OpenSeaFetcherConfig,
  blueprint: OpenSeaListingBlueprint,
  options: Partial<ListingOptions> = {}
): Promise<ListingResult | null> {
  const listingPriceWei = computeListingPrice(options.executionPriceWei ?? 0n, options.markupBps);
  if (listingPriceWei <= 0n) {
    return null;
  }

  const seaport = getSeaport(blueprint.protocolAddress);

  const counter = await getSeaportCounter(blueprint.protocolAddress, TREASURY_ADDRESS);
  const offerItemType = blueprint.offerItemType as SeaportItemType;
  const isErc1155 = offerItemType === SEAPORT_ITEM_TYPE.ERC1155;
  const offerStartAmount = isErc1155 ? 1n : blueprint.offerStartAmount > 0n ? blueprint.offerStartAmount : 1n;
  const offerEndAmount = isErc1155 ? 1n : blueprint.offerEndAmount > 0n ? blueprint.offerEndAmount : 1n;

  const consideration = scaleConsiderationAmounts(
    blueprint.consideration,
    blueprint.originalConsiderationTotal,
    listingPriceWei
  );

  if (offerItemType === SEAPORT_ITEM_TYPE.ERC721 || offerItemType === SEAPORT_ITEM_TYPE.ERC1155) {
    await waitForNftOwnership(
      blueprint.offerToken,
      blueprint.offerIdentifier,
      TREASURY_ADDRESS,
      offerItemType,
      offerStartAmount
    );
  }

  await ensureConduitApproval(blueprint.offerToken, blueprint.conduitKey, blueprint.protocolAddress);

  if (OWNERSHIP_PROPAGATION_DELAY_MS > 0) {
    await debugLog({
      ts: new Date().toISOString(),
      event: "listing_wait_before_prepare",
      delayMs: OWNERSHIP_PROPAGATION_DELAY_MS
    });
    await delay(OWNERSHIP_PROPAGATION_DELAY_MS);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const startTime = now;
  const endTime = now + BigInt(options.listingDuration ?? DEFAULT_LISTING_DURATION);
  const saltHex = bytesToHex(randomBytes(32));
  const salt = hexToBigInt(saltHex);

  const orderComponents: OrderComponents = {
    offerer: TREASURY_ADDRESS,
    zone: blueprint.zone,
    offer: [
      {
        itemType: blueprint.offerItemType,
        token: blueprint.offerToken,
        identifierOrCriteria: blueprint.offerIdentifier.toString(),
        startAmount: offerStartAmount.toString(),
        endAmount: offerEndAmount.toString()
      }
    ],
    consideration: consideration.map((item) => ({
      itemType: item.itemType,
      token: item.token,
      identifierOrCriteria: item.identifierOrCriteria.toString(),
      startAmount: item.amount.toString(),
      endAmount: item.amount.toString(),
      recipient: item.recipient
    })),
    orderType: blueprint.orderType,
    startTime: startTime.toString(),
    endTime: endTime.toString(),
    zoneHash: blueprint.zoneHash,
    salt: salt.toString(),
    conduitKey: blueprint.conduitKey,
    totalOriginalConsiderationItems: consideration.length.toString(),
    counter: counter.toString()
  };

  const orderHash = seaport.getOrderHash(orderComponents);
  const signature = (await seaport.signOrder(orderComponents, TREASURY_ADDRESS)) as Hex;

  await debugLog({
    ts: new Date().toISOString(),
    event: "listing_validate_prepare",
    orderHash,
    orderComponents: serializeForLog(orderComponents),
    signature
  });

  await validateOrderOnchain(orderComponents, blueprint.protocolAddress, orderHash, signature);

  await debugLog({
    ts: new Date().toISOString(),
    event: "listing_ready",
    orderHash,
    orderComponents: serializeForLog(orderComponents),
    signature,
    priceWei: listingPriceWei.toString(),
    counter: counter.toString(),
    salt: salt.toString()
  });

  await debugLog({
    ts: new Date().toISOString(),
    event: "listing_validated_onchain",
    orderHash
  });

  const sellerIndex = blueprint.consideration.findIndex((item) => item.isSellerProceeds);
  const sellerProceeds =
    sellerIndex >= 0 && sellerIndex < consideration.length
      ? consideration[sellerIndex]?.amount ?? 0n
      : 0n;

  return {
    orderHash,
    sellerProceedsWei: sellerProceeds,
    listingPriceWei
  };
}

async function validateOrderOnchain(
  order: OrderComponents,
  protocolAddress: Address,
  orderHash: string,
  signature: string
): Promise<void> {
  const seaport = getSeaport(protocolAddress);
  const calldata = seaport.contract.interface.encodeFunctionData("validate", [[{ parameters: order, signature }]]) as Hex;

  try {
    const txHash = await executeSeaport({
      router: protocolAddress,
      valueWei: 0n,
      calldata,
      callValueWei: 0n
    });

    await debugLog({
      ts: new Date().toISOString(),
      event: "listing_validate_tx_submitted",
      orderHash,
      txHash
    });

    await waitForReceipt(txHash);

    await debugLog({
      ts: new Date().toISOString(),
      event: "listing_validate_tx_confirmed",
      orderHash,
      txHash
    });
  } catch (error) {
    await debugLog({
      ts: new Date().toISOString(),
      event: "listing_validate_tx_error",
      orderHash,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
function computeListingPrice(basePrice: bigint, markupBps?: number): bigint {
  if (basePrice <= 0n) {
    return 0n;
  }
  const bps = BigInt(markupBps ?? DEFAULT_MARKUP_BPS);
  return (basePrice * bps + (BASIS_POINTS_DENOMINATOR - 1n)) / BASIS_POINTS_DENOMINATOR;
}

function scaleConsiderationAmounts(
  items: readonly OpenSeaListingConsiderationBlueprint[],
  originalTotal: bigint,
  newTotal: bigint
): Array<ScaledConsiderationItem> {
  const scaled: Array<ScaledConsiderationItem> = [];
  if (originalTotal === 0n || newTotal === 0n) {
    return scaled;
  }

  let remainder = newTotal;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    let amount = (newTotal * item.originalAmount) / originalTotal;
    if (index === items.length - 1) {
      amount = remainder > 0n ? remainder : 0n;
    } else {
      remainder -= amount;
    }

    const recipient = item.isSellerProceeds ? TREASURY_ADDRESS : item.recipient;

    scaled.push({
      itemType: item.itemType,
      token: item.token,
      identifierOrCriteria: item.identifierOrCriteria,
      amount,
      recipient
    });
  }

  return scaled;
}

async function waitForNftOwnership(
  collection: Address,
  tokenId: bigint,
  expectedOwner: Address,
  itemType: SeaportItemType,
  quantity: bigint
): Promise<void> {
  const normalizedOwner = expectedOwner.toLowerCase();

  for (let attempt = 0; attempt < OWNERSHIP_CHECK_MAX_ATTEMPTS; attempt += 1) {
    if (itemType === SEAPORT_ITEM_TYPE.ERC1155) {
      const rawBalance = await publicClient.readContract({
        address: collection,
        abi: ERC1155_ABI,
        functionName: "balanceOf",
        args: [expectedOwner, tokenId]
      });
      if (typeof rawBalance !== "bigint") {
        throw new Error("Unexpected balanceOf return type");
      }
      const currentBalance = rawBalance;

      await debugLog({
        ts: new Date().toISOString(),
        event: "ownership_check",
        attempt: attempt + 1,
        token: collection,
        tokenId: tokenId.toString(),
        currentBalance: currentBalance.toString()
      });

      if (currentBalance >= quantity) {
        return;
      }
    } else {
      const rawOwner = await publicClient.readContract({
        address: collection,
        abi: ERC721_ABI,
        functionName: "ownerOf",
        args: [tokenId]
      });
      if (typeof rawOwner !== "string") {
        throw new Error("Unexpected ownerOf return type");
      }
      const currentOwner = rawOwner;

      await debugLog({
        ts: new Date().toISOString(),
        event: "ownership_check",
        attempt: attempt + 1,
        token: collection,
        tokenId: tokenId.toString(),
        currentOwner
      });

      if (currentOwner.toLowerCase() === normalizedOwner) {
        return;
      }
    }

    if (attempt + 1 < OWNERSHIP_CHECK_MAX_ATTEMPTS) {
      await delay(OWNERSHIP_CHECK_DELAY_MS);
    }
  }

  if (itemType === SEAPORT_ITEM_TYPE.ERC1155) {
    throw new Error(
      `Treasury balance for token ${tokenId.toString()} on ${collection} did not reach ${quantity.toString()} after ${OWNERSHIP_CHECK_MAX_ATTEMPTS} checks.`
    );
  }

  throw new Error(
    `Token ${tokenId.toString()} on ${collection} is not owned by treasury after ${OWNERSHIP_CHECK_MAX_ATTEMPTS} checks.`
  );
}

async function ensureConduitApproval(
  collection: Address,
  conduitKey: Hex,
  protocolAddress: Address
): Promise<void> {
  if (collection === ZERO_ADDRESS) {
    return;
  }

  const approvalTarget = await resolveApprovalTarget(conduitKey, protocolAddress);
  if (approvalTarget === ZERO_ADDRESS) {
    return;
  }

  const collectionAllowed = await publicClient.readContract({
    address: TREASURY_ADDRESS,
    abi: treasuryAbi,
    functionName: "collections",
    args: [collection]
  });

  if (!collectionAllowed) {
    throw new Error(
      `Treasury collection ${collection} is not allowed. Run setCollection(${collection}, true) from the treasury owner before relisting.`
    );
  }

  const approved = await isApprovedForAll(collection, approvalTarget);
  if (approved) {
    return;
  }

  await debugLog({
    ts: new Date().toISOString(),
    event: "conduit_approval_missing",
    collection,
    approvalTarget
  });

  const txHash = await setCollectionApproval(collection, approvalTarget, true);
  await debugLog({
    ts: new Date().toISOString(),
    event: "conduit_approval_tx_submitted",
    txHash,
    collection,
    approvalTarget
  });
  await waitForReceipt(txHash);

  await debugLog({
    ts: new Date().toISOString(),
    event: "conduit_approval_confirmed",
    txHash,
    collection,
    approvalTarget
  });
}

async function resolveApprovalTarget(conduitKey: Hex, protocolAddress: Address): Promise<Address> {
  if (!conduitKey || conduitKey === ZERO_BYTES32) {
    return protocolAddress;
  }

  const [conduit, exists] = (await publicClient.readContract({
    address: SEAPORT_CONDUIT_CONTROLLER,
    abi: CONDUIT_CONTROLLER_ABI,
    functionName: "getConduit",
    args: [conduitKey]
  })) as [Address, boolean];

  if (!exists) {
    return protocolAddress;
  }

  return conduit;
}

async function isApprovedForAll(collection: Address, operator: Address): Promise<boolean> {
  const approved = await publicClient.readContract({
    address: collection,
    abi: ERC721_APPROVAL_ABI,
    functionName: "isApprovedForAll",
    args: [TREASURY_ADDRESS, operator]
  });
  return Boolean(approved);
}

function serializeForLog(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeForLog);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        serializeForLog(entryValue)
      ])
    );
  }
  return value;
}

interface ScaledConsiderationItem {
  readonly itemType: number;
  readonly token: Address;
  readonly identifierOrCriteria: bigint;
  readonly amount: bigint;
  readonly recipient: Address;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
