import { JsonRpcProvider as JsonRpcProviderV6, Wallet } from "ethers";
import { Seaport } from "@opensea/seaport-js";
import { SeaportOrderValidator } from "@opensea/seaport-order-validator";
import { OpenSeaSDK, Chain } from "opensea-js";
import { JsonRpcProvider as JsonRpcProviderV5 } from "@ethersproject/providers";

import {
  CHAIN_ID,
  OPENSEA_API_KEY,
  OPENSEA_API_URL,
  OPERATOR_PRIVATE_KEY,
  RPC_URL
} from "../config.js";

const DEFAULT_CHAIN_ID = CHAIN_ID ?? 8453;

const CHAIN_ID_TO_OPENSEA_CHAIN: Record<number, Chain> = {
  1: Chain.Mainnet,
  10: Chain.Optimism,
  137: Chain.Polygon,
  42161: Chain.Arbitrum,
  8453: Chain.Base
};

let cachedProvider: JsonRpcProviderV6 | null = null;
let cachedWallet: Wallet | null = null;
const OPENSEA_SEAPORT_V1_6 = "0x0000000000000068F116a894984e2DB1123eB395";
let cachedSeaportByAddress: Map<string, Seaport> | null = null;
let cachedSdk: OpenSeaSDK | null = null;
let cachedValidator: SeaportOrderValidator | null = null;
let cachedValidatorProvider: JsonRpcProviderV5 | null = null;

type SeaportInit = ConstructorParameters<typeof Seaport>[0];
type OpenSeaSdkInit = ConstructorParameters<typeof OpenSeaSDK>[0];
function resolveChain(chainId: number): Chain {
  return CHAIN_ID_TO_OPENSEA_CHAIN[chainId] ?? Chain.Base;
}

export function getEthersProvider(): JsonRpcProviderV6 {
  if (!cachedProvider) {
    cachedProvider = new JsonRpcProviderV6(RPC_URL, {
      chainId: DEFAULT_CHAIN_ID,
      name: `chain-${DEFAULT_CHAIN_ID}`
    });
  }
  return cachedProvider;
}

export function getOperatorWallet(): Wallet {
  if (!cachedWallet) {
    cachedWallet = new Wallet(OPERATOR_PRIVATE_KEY, getEthersProvider());
  }
  return cachedWallet;
}

export function getSeaport(protocolAddress?: string): Seaport {
  const address = protocolAddress ?? OPENSEA_SEAPORT_V1_6;
  cachedSeaportByAddress ??= new Map();

  let seaport = cachedSeaportByAddress.get(address.toLowerCase());
  if (!seaport) {
    seaport = new Seaport(getOperatorWallet() as unknown as SeaportInit, {
      overrides: {
        contractAddress: address,
        seaportVersion: "1.6"
      }
    });
    cachedSeaportByAddress.set(address.toLowerCase(), seaport);
  }
  return seaport;
}

export function getOpenSeaSdk(): OpenSeaSDK {
  if (!cachedSdk) {
    cachedSdk = new OpenSeaSDK(getOperatorWallet() as unknown as OpenSeaSdkInit, {
      apiKey: OPENSEA_API_KEY,
      apiBaseUrl: OPENSEA_API_URL,
      chain: resolveChain(DEFAULT_CHAIN_ID)
    });
  }
  return cachedSdk;
}

export function getOrderValidator(): SeaportOrderValidator {
  if (!cachedValidator) {
    cachedValidatorProvider ??= new JsonRpcProviderV5(RPC_URL);
    cachedValidator = new SeaportOrderValidator(cachedValidatorProvider);
  }
  return cachedValidator;
}
