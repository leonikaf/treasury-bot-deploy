export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export interface ExecuteSeaportRequest {
  readonly router: Address;
  readonly valueWei: bigint;
  readonly calldata: Hex;
  readonly callValueWei?: bigint;
}

export interface ExecutionPayload {
  readonly router: Address;
  readonly calldata: Hex;
  readonly valueWei: bigint;
  readonly priceWei?: bigint;
  readonly source?: string;
  readonly openSeaMetadata?: OpenSeaListingBlueprint;
}

export interface OpenSeaListingConsiderationBlueprint {
  readonly itemType: number;
  readonly token: Address;
  readonly identifierOrCriteria: bigint;
  readonly originalAmount: bigint;
  readonly recipient: Address;
  readonly isSellerProceeds: boolean;
}

export interface OpenSeaListingBlueprint {
  readonly protocolAddress: Address;
  readonly offerToken: Address;
  readonly offerIdentifier: bigint;
  readonly offerItemType: number;
  readonly offerStartAmount: bigint;
  readonly offerEndAmount: bigint;
  readonly conduitKey: Hex;
  readonly zone: Address;
  readonly zoneHash: Hex;
  readonly orderType: number;
  readonly consideration: readonly OpenSeaListingConsiderationBlueprint[];
  readonly totalOriginalConsiderationItems: number;
  readonly originalConsiderationTotal: bigint;
  readonly counter: bigint;
  readonly collectionSlug?: string | null;
}

export type TokenStandard = "erc721" | "erc1155";

export interface ActiveListingState {
  readonly orderHash: string;
  readonly collection: Address;
  readonly tokenId: string;
  readonly expectedProceedsWei: bigint;
  readonly listedAtMs: number;
  readonly tokenStandard: TokenStandard;
  readonly listedQuantity: bigint;
  readonly expectedPostSaleBalance: bigint | null;
}

export interface BotState {
  readonly version: number;
  commissionPoolWei: bigint;
  salePoolWei: bigint;
  pendingBurnAmount: bigint;
  pendingBurnCostWei: bigint;
  activeListings: ActiveListingState[];
  lastTaxBlock: bigint;
}
