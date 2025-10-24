import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { OrderWithCounter } from "@opensea/seaport-js/lib/types.js";
import { OrderSide } from "opensea-js";
import type { Listing } from "opensea-js/lib/api/types.js";
import type { OrderV2, OrdersQueryOptions } from "opensea-js/lib/orders/types.js";
import { getAddress, isAddress } from "viem";

import type {
  Address,
  ExecutionPayload,
  Hex,
  OpenSeaListingBlueprint,
  OpenSeaListingConsiderationBlueprint
} from "../types.js";
import { getOpenSeaSdk, getSeaport } from "./openseaClients.js";

export const OPENSEA_CHAIN_SLUG: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  137: "matic",
  42161: "arbitrum",
  8453: "base"
};

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const DEFAULT_SEAPORT_ADDRESS: Address = getAddress("0x0000000000000068f116a894984e2db1123eb395");
const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;
const EMPTY_HEX: Hex = "0x";

export interface OpenSeaFetcherConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly chainId: number;
  readonly taker: Address;
}

export interface OpenSeaTargetItem {
  readonly collection?: Address | null;
  readonly collectionSlug?: string | null;
  readonly tokenId?: string | null;
}

const DEBUG_LOG_PATH = resolve(
  process.cwd(),
  process.env.OPENSEA_DEBUG_LOG ?? "opensea-debug.log"
);

let debugLogInitialized = false;

export async function debugLog(entry: unknown): Promise<void> {
  try {
    if (!debugLogInitialized) {
      await writeFile(DEBUG_LOG_PATH, "");
      debugLogInitialized = true;
    }
    await appendFile(DEBUG_LOG_PATH, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
  } catch {
    // Swallow logging errors to avoid affecting execution flow.
  }
}

export async function fetchOpenSeaBuyExecution(
  config: OpenSeaFetcherConfig,
  target: OpenSeaTargetItem
): Promise<ExecutionPayload> {
  const sdk = getOpenSeaSdk();
  let seaport = getSeaport();

  await debugLog({
    ts: new Date().toISOString(),
    event: "opensea_fetch_start",
    chainId: config.chainId,
    target
  });

  const resolvedOrder = await resolveOrder(sdk.api, seaport, target);
  const orderWithSignature = await ensureOrderHasSignature(
    sdk.api,
    resolvedOrder,
    config.taker
  );
  seaport = getSeaport(resolvedOrder.protocolAddress);

  await debugLog({
    ts: new Date().toISOString(),
    event: "opensea_order_resolved",
    orderHash: resolvedOrder.orderHash,
    priceWei: resolvedOrder.price.toString()
  });
  const isErc1155Offer: boolean =
    Number(orderWithSignature.parameters.offer?.[0]?.itemType) === 3;
  const fulfillUseCase = await seaport.fulfillOrder(
    isErc1155Offer
      ? {
          order: orderWithSignature,
          accountAddress: config.taker,
          conduitKey: orderWithSignature.parameters.conduitKey,
          unitsToFill: 1
        }
      : {
          order: orderWithSignature,
          accountAddress: config.taker,
          conduitKey: orderWithSignature.parameters.conduitKey
        }
  );

  const exchangeAction = fulfillUseCase.actions.find(
    (action): action is typeof fulfillUseCase.actions[number] & {
      type: "exchange";
      transactionMethods: typeof fulfillUseCase.actions[number]["transactionMethods"];
    } => action.type === "exchange"
  );

  if (!exchangeAction) {
    throw new Error("Seaport fulfillOrder did not return an exchange action");
  }

  const transaction = await exchangeAction.transactionMethods.buildTransaction();
  if (!transaction.to || !transaction.data) {
    throw new Error("Seaport fulfillOrder missing transaction fields");
  }

  const valueWei = toBigInt(transaction.value);
  const priceWei = resolvedOrder.price > 0n ? resolvedOrder.price : valueWei;

  const metadata = buildOpenSeaListingBlueprint(
    orderWithSignature,
    resolvedOrder.protocolAddress,
    resolvedOrder.collectionSlug
  );

  const router = normalizeAddress(transaction.to, resolvedOrder.protocolAddress);
  const calldata = normalizeHex(transaction.data, EMPTY_HEX);

  return {
    router,
    calldata,
    valueWei,
    priceWei,
    source: "opensea",
    openSeaMetadata: metadata ?? undefined
  };
}

interface ResolvedOrder {
  readonly orderHash: string;
  readonly protocolData: OrderWithCounter;
  readonly protocolAddress: Address;
  readonly price: bigint;
  readonly collectionSlug: string | null;
}

async function resolveOrder(
  api: ReturnType<typeof getOpenSeaSdk>["api"],
  seaport: ReturnType<typeof getSeaport>,
  target: OpenSeaTargetItem
): Promise<ResolvedOrder> {
  if (target.collection && target.tokenId) {
    const query: OrdersQueryOptions = {
      side: OrderSide.LISTING,
      orderBy: "eth_price",
      orderDirection: "asc",
      assetContractAddress: target.collection,
      tokenIds: [target.tokenId]
    };

    const order = await api.getOrder(query);
    return mapOrderV2(order, seaport, target.collectionSlug ?? null);
  }

  if (target.collectionSlug) {
    const bestListings = await api.getBestListings(target.collectionSlug, 1);
    const listing = bestListings.listings?.[0];

    if (!listing) {
      throw new Error(`No active OpenSea listings for collection slug ${target.collectionSlug}`);
    }

    return mapListing(listing, target.collectionSlug);
  }

  throw new Error(
    "Either TARGET_TOKEN_ID + TARGET_COLLECTION or TARGET_COLLECTION_SLUG must be provided"
  );
}

function mapOrderV2(
  order: OrderV2,
  seaport: ReturnType<typeof getSeaport>,
  collectionSlug: string | null
): ResolvedOrder {
  const protocolDataCandidate = order.protocolData;
  assertOrderWithCounter(protocolDataCandidate);

  const orderHash =
    order.orderHash ?? seaport.getOrderHash(protocolDataCandidate.parameters);

  return {
    orderHash,
    protocolData: protocolDataCandidate,
    protocolAddress: normalizeAddress(order.protocolAddress, DEFAULT_SEAPORT_ADDRESS),
    price: order.currentPrice,
    collectionSlug
  };
}

function mapListing(listing: Listing, collectionSlug: string | null): ResolvedOrder {
  const protocolDataCandidate = listing.protocol_data;
  assertOrderWithCounter(protocolDataCandidate);
  const priceSource =
    (listing.price &&
    typeof listing.price === "object" &&
    listing.price !== null
      ? (listing.price as {
          current?: { value?: string | number | bigint | null };
          amount?: { raw?: string | number | bigint | null };
        }).current?.value ??
        (listing.price as {
          current?: { value?: string | number | bigint | null };
          amount?: { raw?: string | number | bigint | null };
        }).amount?.raw
      : null) ?? null;
  const price = priceSource !== null ? toBigInt(priceSource) : 0n;

  return {
    orderHash: listing.order_hash,
    protocolData: protocolDataCandidate,
    protocolAddress: normalizeAddress(listing.protocol_address, DEFAULT_SEAPORT_ADDRESS),
    price,
    collectionSlug
  };
}

function buildOpenSeaListingBlueprint(
  order: OrderWithCounter,
  protocolAddress: Address,
  collectionSlug: string | null
): OpenSeaListingBlueprint | null {
  const parameters = order.parameters;
  if (!parameters.offer || parameters.offer.length === 0) {
    return null;
  }

  const offerItem = parameters.offer[0];
  const offerStartAmount = toBigInt(offerItem.startAmount);
  const offerEndAmount = toBigInt(offerItem.endAmount);
  const offerer = normalizeAddress(parameters.offerer);
  const offerToken = normalizeAddress(offerItem.token, ZERO_ADDRESS);

  const considerationBlueprint: OpenSeaListingConsiderationBlueprint[] = parameters.consideration.map(
    (item): OpenSeaListingConsiderationBlueprint => {
      const amount = toBigInt(item.startAmount);
      const recipient = normalizeAddress(item.recipient);

      return {
        itemType: Number(item.itemType),
        token: normalizeAddress(item.token, ZERO_ADDRESS),
        identifierOrCriteria: toBigInt(item.identifierOrCriteria),
        originalAmount: amount,
        recipient,
        isSellerProceeds: recipient === offerer
      };
    }
  );

  const originalTotal = considerationBlueprint.reduce(
    (accumulator, item) => accumulator + item.originalAmount,
    0n
  );

  if (considerationBlueprint.length === 0 || originalTotal === 0n) {
    return null;
  }

  return {
    protocolAddress,
    offerToken,
    offerIdentifier: toBigInt(offerItem.identifierOrCriteria),
    offerItemType: Number(offerItem.itemType),
    offerStartAmount: offerStartAmount > 0n ? offerStartAmount : 1n,
    offerEndAmount: offerEndAmount > 0n ? offerEndAmount : 1n,
    conduitKey: normalizeHex(parameters.conduitKey),
    zone: normalizeAddress(parameters.zone),
    zoneHash: normalizeHex(parameters.zoneHash),
    orderType: Number(parameters.orderType),
    consideration: considerationBlueprint,
    totalOriginalConsiderationItems: parameters.consideration.length,
    originalConsiderationTotal: originalTotal,
    counter: toBigInt(parameters.counter),
    collectionSlug
  };
}

async function ensureOrderHasSignature(
  api: ReturnType<typeof getOpenSeaSdk>["api"],
  order: ResolvedOrder,
  fulfiller: Address
): Promise<OrderWithCounter> {
  const currentOrder = order.protocolData;
  const existingSignature = extractSignature(currentOrder.signature);
  if (existingSignature) {
    return {
      ...currentOrder,
      signature: existingSignature
    };
  }

  const fulfillment = await api.generateFulfillmentData(
    fulfiller,
    order.orderHash,
    order.protocolAddress,
    OrderSide.LISTING
  );

  const hydratedOrder = fulfillment.fulfillment_data?.orders?.[0];
  if (!hydratedOrder) {
    throw new Error("OpenSea fulfillment response missing protocol data");
  }

  assertOrderWithCounter(hydratedOrder);

  const fulfilledSignature = extractSignature(hydratedOrder.signature);
  if (!fulfilledSignature) {
    throw new Error("OpenSea fulfillment response missing signature");
  }

  return {
    ...hydratedOrder,
    signature: fulfilledSignature
  };
}

function extractSignature(candidate: unknown): string | null {
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.length === 0 || trimmed === "0x") {
      return null;
    }
    return trimmed;
  }

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  if ("signature" in candidate) {
    return extractSignature((candidate as { signature: unknown }).signature);
  }

  if ("data" in candidate) {
    return extractSignature((candidate as { data: unknown }).data);
  }

  return null;
}

function assertOrderWithCounter(candidate: unknown): asserts candidate is OrderWithCounter {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("OpenSea order missing protocol data");
  }

  if (!("parameters" in candidate)) {
    throw new Error("OpenSea order protocol data missing parameters");
  }

  const parameters = (candidate as { parameters: unknown }).parameters;
  if (!parameters || typeof parameters !== "object") {
    throw new Error("OpenSea order parameters have unexpected shape");
  }
}

function normalizeAddress(value: unknown, fallback: Address = ZERO_ADDRESS): Address {
  if (typeof value === "string" && isAddress(value)) {
    return getAddress(value);
  }
  return fallback;
}

function normalizeHex(value: unknown, fallback: Hex = ZERO_BYTES32): Hex {
  if (isHexString(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    const hexString: Hex = `0x${value.toString(16)}`;
    return hexString;
  }

  return fallback;
}

function isHexString(value: unknown): value is Hex {
  if (typeof value !== "string") {
    return false;
  }

  if (!value.startsWith("0x")) {
    return false;
  }

  return /^0x[0-9a-fA-F]*$/.test(value) && value.length >= 2;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    if (value.trim().length === 0) {
      return 0n;
    }
    return BigInt(value);
  }
  if (value === null || value === undefined) {
    return 0n;
  }
  throw new Error(`Unable to coerce value ${String(value)} to bigint`);
}




