import { stringToHex } from "viem";

import type { Address, Hex } from "../types.js";

export interface SeaportOfferItem {
  readonly token: Address;
  readonly identifier: bigint;
  readonly amount: bigint;
}

export interface SeaportConsiderationItem extends SeaportOfferItem {
  readonly recipient: Address;
}

export interface SeaportStubParams {
  readonly offerer: Address;
  readonly offer: readonly SeaportOfferItem[];
  readonly consideration: readonly SeaportConsiderationItem[];
  readonly deadline: number;
  readonly note?: string;
}

export function buildSeaportStubCalldata(params: SeaportStubParams): Hex {
  const payload = {
    kind: "seaport-stub",
    version: 1,
    order: {
      offerer: params.offerer,
      offer: params.offer.map((item) => ({
        token: item.token,
        identifier: item.identifier.toString(),
        amount: item.amount.toString()
      })),
      consideration: params.consideration.map((item) => ({
        token: item.token,
        identifier: item.identifier.toString(),
        amount: item.amount.toString(),
        recipient: item.recipient
      })),
      deadline: params.deadline,
      note: params.note ?? null
    }
  };

  return stringToHex(JSON.stringify(payload));
}
