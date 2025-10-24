import { encodeAbiParameters, keccak256 } from "viem";

import type { Address, Hex } from "../types.js";

const textEncoder = new TextEncoder();

const OFFER_ITEM_TYPEHASH = keccak256(
  textEncoder.encode(
    "OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)"
  )
);

const CONSIDERATION_ITEM_TYPEHASH = keccak256(
  textEncoder.encode(
    "ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)"
  )
);

const ORDER_TYPEHASH = keccak256(
  textEncoder.encode(
    "OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 totalOriginalConsiderationItems,uint256 counter)OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)"
  )
);

export interface SeaportOfferItem {
  readonly itemType: number;
  readonly token: Address;
  readonly identifierOrCriteria: bigint;
  readonly startAmount: bigint;
  readonly endAmount: bigint;
}

export interface SeaportConsiderationItem extends SeaportOfferItem {
  readonly recipient: Address;
}

export interface SeaportOrderComponents {
  readonly offerer: Address;
  readonly zone: Address;
  readonly offer: readonly SeaportOfferItem[];
  readonly consideration: readonly SeaportConsiderationItem[];
  readonly orderType: number;
  readonly startTime: bigint;
  readonly endTime: bigint;
  readonly zoneHash: Hex;
  readonly salt: bigint;
  readonly conduitKey: Hex;
  readonly totalOriginalConsiderationItems: bigint;
  readonly counter: bigint;
}

export function deriveSeaportOrderHash(order: SeaportOrderComponents): Hex {
  const offerHashes = order.offer.map(hashOfferItem);
  const considerationHashes = order.consideration.map(hashConsiderationItem);

  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" }
      ],
      [
        ORDER_TYPEHASH,
        order.offerer,
        order.zone,
        hashStructArray(offerHashes),
        hashStructArray(considerationHashes),
        order.orderType,
        BigInt(order.startTime),
        BigInt(order.endTime),
        order.zoneHash,
        BigInt(order.salt),
        order.conduitKey,
        BigInt(order.totalOriginalConsiderationItems),
        BigInt(order.counter)
      ]
    )
  );
}

function hashOfferItem(item: SeaportOfferItem): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint8" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" }
      ],
      [
        OFFER_ITEM_TYPEHASH,
        item.itemType,
        item.token,
        BigInt(item.identifierOrCriteria),
        BigInt(item.startAmount),
        BigInt(item.endAmount)
      ]
    )
  );
}

function hashConsiderationItem(item: SeaportConsiderationItem): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint8" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" }
      ],
      [
        CONSIDERATION_ITEM_TYPEHASH,
        item.itemType,
        item.token,
        BigInt(item.identifierOrCriteria),
        BigInt(item.startAmount),
        BigInt(item.endAmount),
        item.recipient
      ]
    )
  );
}

function hashStructArray(hashes: readonly Hex[]): Hex {
  if (hashes.length === 0) {
    return keccak256("0x");
  }

  const concatenated: Hex = `0x${hashes.map((hash) => hash.slice(2)).join("")}`;
  return keccak256(concatenated);
}
