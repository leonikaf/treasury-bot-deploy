import "dotenv/config";

import { hashTypedData, Hex, PublicClient } from "viem";
import { base } from "viem/chains";
import { randomBytes } from "node:crypto";

import {
  CHAIN_ID,
  OPENSEA_API_KEY,
  OPENSEA_API_URL,
  SEAPORT_ROUTER,
  TARGET_COLLECTION,
  TARGET_COLLECTION_SLUG,
  TARGET_TOKEN_ID,
  TREASURY_ADDRESS
} from "../src/config.js";
import {
  fetchOpenSeaBuyExecution,
  type OpenSeaFetcherConfig,
  type OpenSeaTargetItem
} from "../src/marketplaces/opensea.js";
import { deriveSeaportOrderHash } from "../src/marketplaces/seaportOrderHash.js";
import { getSeaportCounter, publicClient, signTypedDataWithOperator, treasuryAbi } from "../src/treasuryClient.js";

type OrderComponentsStruct = {
  offerer: string;
  zone: string;
  offer: Array<{ itemType: number; token: string; identifierOrCriteria: bigint; startAmount: bigint; endAmount: bigint }>;
  consideration: Array<{
    itemType: number;
    token: string;
    identifierOrCriteria: bigint;
    startAmount: bigint;
    endAmount: bigint;
    recipient: string;
  }>;
  orderType: number;
  startTime: bigint;
  endTime: bigint;
  zoneHash: Hex;
  salt: bigint;
  conduitKey: Hex;
  totalOriginalConsiderationItems: bigint;
  counter: bigint;
};

const SEAPORT_ABI = [
  {
    type: "function",
    name: "getOrderHash",
    stateMutability: "view",
    inputs: [
      {
        name: "orderComponents",
        type: "tuple",
        components: [
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          {
            name: "offer",
            type: "tuple[]",
            components: [
              { name: "itemType", type: "uint8" },
              { name: "token", type: "address" },
              { name: "identifierOrCriteria", type: "uint256" },
              { name: "startAmount", type: "uint256" },
              { name: "endAmount", type: "uint256" }
            ]
          },
          {
            name: "consideration",
            type: "tuple[]",
            components: [
              { name: "itemType", type: "uint8" },
              { name: "token", type: "address" },
              { name: "identifierOrCriteria", type: "uint256" },
              { name: "startAmount", type: "uint256" },
              { name: "endAmount", type: "uint256" },
              { name: "recipient", type: "address" }
            ]
          },
          { name: "orderType", type: "uint8" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "conduitKey", type: "bytes32" },
          { name: "totalOriginalConsiderationItems", type: "uint256" },
          { name: "counter", type: "uint256" }
        ]
      }
    ],
    outputs: [{ name: "", type: "bytes32" }]
  },
  {
    type: "function",
    name: "validate",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "orders",
        type: "tuple[]",
        components: [
          {
            name: "parameters",
            type: "tuple",
            components: [
              { name: "offerer", type: "address" },
              { name: "zone", type: "address" },
              {
                name: "offer",
                type: "tuple[]",
                components: [
                  { name: "itemType", type: "uint8" },
                  { name: "token", type: "address" },
                  { name: "identifierOrCriteria", type: "uint256" },
                  { name: "startAmount", type: "uint256" },
                  { name: "endAmount", type: "uint256" }
                ]
              },
              {
                name: "consideration",
                type: "tuple[]",
                components: [
                  { name: "itemType", type: "uint8" },
                  { name: "token", type: "address" },
                  { name: "identifierOrCriteria", type: "uint256" },
                  { name: "startAmount", type: "uint256" },
                  { name: "endAmount", type: "uint256" },
                  { name: "recipient", type: "address" }
                ]
              },
              { name: "orderType", type: "uint8" },
              { name: "startTime", type: "uint256" },
              { name: "endTime", type: "uint256" },
              { name: "zoneHash", type: "bytes32" },
              { name: "salt", type: "uint256" },
              { name: "conduitKey", type: "bytes32" },
              { name: "totalOriginalConsiderationItems", type: "uint256" },
              { name: "counter", type: "uint256" }
            ]
          },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: [{ name: "", type: "bool[]" }]
  }
] as const;

const ERC721_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }]
  },
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const ORDER_EIP712_TYPES = {
  OfferItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" }
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" }
  ],
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "totalOriginalConsiderationItems", type: "uint256" },
    { name: "counter", type: "uint256" }
  ]
} as const;

const IS_VALID_SIGNATURE_ABI = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" }
    ],
    outputs: [{ name: "", type: "bytes4" }]
  }
] as const;

async function main(): Promise<void> {
  const slug = TARGET_COLLECTION_SLUG ?? process.env.DEBUG_COLLECTION_SLUG ?? null;
  if (!slug) {
    throw new Error("TARGET_COLLECTION_SLUG (or DEBUG_COLLECTION_SLUG) must be provided");
  }

  const config: OpenSeaFetcherConfig = {
    apiUrl: OPENSEA_API_URL,
    apiKey: OPENSEA_API_KEY,
    chainId: CHAIN_ID ?? base.id,
    taker: TREASURY_ADDRESS
  };

  const target: OpenSeaTargetItem = {
    collectionSlug: slug,
    collection: TARGET_COLLECTION,
    tokenId: TARGET_TOKEN_ID ?? process.env.DEBUG_TARGET_TOKEN_ID ?? null
  };

  console.log("=== OpenSea Diagnostics ===");
  console.log("Target collection slug:", slug);
  if (target.collection) {
    console.log("Target collection address:", target.collection);
  }
  if (target.tokenId) {
    console.log("Target token id:", target.tokenId);
  }

  console.log("\nStep 1: fetch execution payload from OpenSea...");
  const execution = await fetchOpenSeaBuyExecution(config, target);
  console.log(JSON.stringify(execution, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2));

  if (!execution.openSeaMetadata) {
    throw new Error("Execution payload missing openSeaMetadata blueprint");
  }

  const blueprint = execution.openSeaMetadata;
  const counter = await getSeaportCounter(blueprint.protocolAddress, TREASURY_ADDRESS);
  console.log("\nSeaport counter (chain read):", counter.toString());

  const startAmount = blueprint.offerStartAmount > 0n ? blueprint.offerStartAmount : 1n;
  const endAmount = blueprint.offerEndAmount > 0n ? blueprint.offerEndAmount : 1n;

  const consideration = scaleConsiderationAmounts(blueprint.consideration, blueprint.originalConsiderationTotal, execution.priceWei);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const startTime = now;
  const endTime = startTime + 7n * 24n * 60n * 60n;
  const saltHex = cryptoRandomHex(32);
  const saltBigint = BigInt(saltHex);

  const typedDataMessage: OrderComponentsStruct = {
    offerer: TREASURY_ADDRESS,
    zone: blueprint.zone,
    offer: [
      {
        itemType: blueprint.offerItemType,
        token: blueprint.offerToken,
        identifierOrCriteria: blueprint.offerIdentifier,
        startAmount,
        endAmount
      }
    ],
    consideration: consideration.map((item) => ({
      itemType: item.itemType,
      token: item.token,
      identifierOrCriteria: item.identifierOrCriteria,
      startAmount: item.amount,
      endAmount: item.amount,
      recipient: item.recipient
    })),
    orderType: blueprint.orderType,
    startTime,
    endTime,
    zoneHash: blueprint.zoneHash,
    salt: saltBigint,
    conduitKey: blueprint.conduitKey,
    totalOriginalConsiderationItems: BigInt(consideration.length),
    counter
  };

  const typedDataDomain = {
    name: "Seaport",
    version: "1.6",
    chainId: config.chainId,
    verifyingContract: blueprint.protocolAddress
  } as const;

  const orderStructHash = deriveSeaportOrderHash({
    offerer: typedDataMessage.offerer,
    zone: typedDataMessage.zone,
    offer: typedDataMessage.offer,
    consideration: typedDataMessage.consideration,
    orderType: Number(typedDataMessage.orderType),
    startTime: typedDataMessage.startTime,
    endTime: typedDataMessage.endTime,
    zoneHash: typedDataMessage.zoneHash,
    salt: typedDataMessage.salt,
    conduitKey: typedDataMessage.conduitKey,
    totalOriginalConsiderationItems: typedDataMessage.totalOriginalConsiderationItems,
    counter: typedDataMessage.counter
  });

  const signature = await signTypedDataWithOperator({
    domain: typedDataDomain,
    types: ORDER_EIP712_TYPES,
    primaryType: "OrderComponents",
    message: typedDataMessage
  });

  const typedDataDigest = hashTypedData({
    domain: typedDataDomain,
    types: ORDER_EIP712_TYPES,
    primaryType: "OrderComponents",
    message: typedDataMessage
  });

  console.log("\nTyped data message prepared.");
  console.log("Order struct hash:", orderStructHash);
  console.log("Order hash:", typedDataDigest);
  console.log("Signature:", signature);

  const signatureCheck = await publicClient.readContract({
    address: TREASURY_ADDRESS,
    abi: IS_VALID_SIGNATURE_ABI,
    functionName: "isValidSignature",
    args: [typedDataDigest, signature]
  });

  console.log("isValidSignature result:", signatureCheck);

  await runOnChainDiagnostics(publicClient, blueprint.offerToken, blueprint.protocolAddress, typedDataMessage, signature);

  const apiPayload = formatApiPayload(typedDataMessage, signature);
  console.log("\nListing API payload (copy for OpenSea validator):");
  console.log(JSON.stringify(apiPayload, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2));
}

function cryptoRandomHex(bytes: number): Hex {
  const buffer = randomBytes(bytes);
  return ("0x" + buffer.toString("hex")) as Hex;
}

function scaleConsiderationAmounts(
  items: readonly {
    itemType: number;
    token: string;
    identifierOrCriteria: bigint;
    originalAmount: bigint;
    recipient: string;
    isSellerProceeds: boolean;
  }[],
  originalTotal: bigint,
  newTotal: bigint
) {
  const scaled: Array<{
    itemType: number;
    token: string;
    identifierOrCriteria: bigint;
    amount: bigint;
    recipient: string;
  }> = [];

  if (originalTotal === 0n || newTotal === 0n) {
    return scaled;
  }

  let remainder = newTotal;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
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

async function runOnChainDiagnostics(
  client: PublicClient,
  collection: string,
  seaportAddress: string,
  message: OrderComponentsStruct,
  signature: Hex
): Promise<void> {
  console.log("\n=== On-chain diagnostics ===");

  const owner = await client.readContract({
    address: collection,
    abi: ERC721_ABI,
    functionName: "ownerOf",
    args: [message.offer[0]!.identifierOrCriteria]
  });
  console.log("ownerOf(tokenId):", owner);

  const approved = await client.readContract({
    address: collection,
    abi: ERC721_ABI,
    functionName: "isApprovedForAll",
    args: [TREASURY_ADDRESS, SEAPORT_ROUTER ?? ZERO_ADDRESS]
  });
  console.log("isApprovedForAll(treasury, seaportRouter):", approved);

  const orderHash = await client.readContract({
    address: seaportAddress,
    abi: SEAPORT_ABI,
    functionName: "getOrderHash",
    args: [message]
  });
  console.log("Seaport.getOrderHash:", orderHash);

  try {
    const simulation = await client.simulateContract({
      address: seaportAddress,
      abi: SEAPORT_ABI,
      functionName: "validate",
      args: [[{ parameters: message, signature }]],
      account: TREASURY_ADDRESS
    });
    console.log("Seaport.validate simulation:", simulation.result);
  } catch (error) {
    console.error("Seaport.validate reverted:", error instanceof Error ? error.message : String(error));
  }
}

function formatApiPayload(message: OrderComponentsStruct, signature: Hex) {
  return {
    protocol_address: "0x0000000000000068f116a894984e2db1123eb395",
    parameters: {
      offerer: message.offerer,
      offer: message.offer.map((item) => ({
        itemType: item.itemType,
        token: item.token,
        identifierOrCriteria: item.identifierOrCriteria.toString(),
        startAmount: item.startAmount.toString(),
        endAmount: item.endAmount.toString()
      })),
      consideration: message.consideration.map((item) => ({
        itemType: item.itemType,
        token: item.token,
        identifierOrCriteria: item.identifierOrCriteria.toString(),
        startAmount: item.startAmount.toString(),
        endAmount: item.endAmount.toString(),
        recipient: item.recipient
      })),
      startTime: message.startTime.toString(),
      endTime: message.endTime.toString(),
      orderType: Number(message.orderType),
      zone: message.zone,
      zoneHash: message.zoneHash,
      salt: `0x${message.salt.toString(16).padStart(64, "0")}`,
      conduitKey: message.conduitKey,
      totalOriginalConsiderationItems: Number(message.totalOriginalConsiderationItems),
      counter: message.counter.toString()
    },
    signature,
    restricted_by_zone: false
  };
}

main().catch((error) => {
  console.error("Diagnostics failed:", error);
  process.exitCode = 1;
});
