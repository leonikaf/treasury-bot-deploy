import type { Chain } from "viem";
import {
  TransactionNotFoundError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http
} from "viem";
import type { TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { CHAIN_ID, OPERATOR_PRIVATE_KEY, RPC_URL, TREASURY_ADDRESS } from "./config.js";
import type { Address, ExecuteSeaportRequest, Hex } from "./types.js";
import { logger } from "./utils/logger.js";

const treasuryAbi = [
  {
    type: "function",
    name: "executeSeaport",
    stateMutability: "payable",
    inputs: [
      { name: "router", type: "address", internalType: "address" },
      { name: "value", type: "uint256", internalType: "uint256" },
      { name: "data", type: "bytes", internalType: "bytes" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "setCollectionApproval",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collection", type: "address", internalType: "address" },
      { name: "operator", type: "address", internalType: "address" },
      { name: "approved", type: "bool", internalType: "bool" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "collections",
    stateMutability: "view",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }]
  },
] as const;

const transport = http(RPC_URL);
const account = privateKeyToAccount(OPERATOR_PRIVATE_KEY);

const resolvedChain: Chain =
  CHAIN_ID === null || CHAIN_ID === base.id
    ? base
    : defineChain({
        id: CHAIN_ID,
        name: `chain-${CHAIN_ID}`,
        network: `chain-${CHAIN_ID}`,
        nativeCurrency: {
          name: "Ether",
          symbol: "ETH",
          decimals: 18
        },
        rpcUrls: {
          default: { http: [RPC_URL] },
          public: { http: [RPC_URL] }
        }
      });

type PublicClientInstance = ReturnType<typeof createPublicClient>;

export const publicClient: PublicClientInstance = createPublicClient({ transport, chain: resolvedChain });
const walletClient = createWalletClient({ account, transport, chain: resolvedChain });
type OperatorSignTypedDataParams = Parameters<typeof walletClient.signTypedData>[0];
const walletChain = resolvedChain;

const seaportAbi = [
  {
    type: "function",
    name: "getCounter",
    stateMutability: "view",
    inputs: [{ name: "offerer", type: "address", internalType: "address" }],
    outputs: [{ name: "counter", type: "uint256", internalType: "uint256" }]
  }
] as const;

export async function getTreasuryBalance(): Promise<bigint> {
  return publicClient.getBalance({ address: TREASURY_ADDRESS });
}

export async function executeSeaport(request: ExecuteSeaportRequest): Promise<Hex> {
  return writeContractWithAdaptiveFees({
    address: TREASURY_ADDRESS,
    abi: treasuryAbi,
    functionName: "executeSeaport",
    chain: walletChain,
    args: [request.router, request.valueWei, request.calldata],
    account
  });
}

export async function setCollectionApproval(
  collection: Address,
  operator: Address,
  approved: boolean
): Promise<Hex> {
  return writeContractWithAdaptiveFees({
    address: TREASURY_ADDRESS,
    abi: treasuryAbi,
    functionName: "setCollectionApproval",
    chain: walletChain,
    args: [collection, operator, approved],
    account
  });
}

export async function topUpTreasury(amountWei: bigint): Promise<Hex> {
  return sendTransactionWithAdaptiveFees({
    to: TREASURY_ADDRESS,
    value: amountWei
  });
}

export async function waitForReceipt(txHash: Hex): Promise<TransactionReceipt> {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction reverted: ${txHash}`);
    }
    return receipt;
  } catch (error) {
    if (error instanceof TransactionNotFoundError) {
      resetNonceCache();
    }
    throw error;
  }
}

export async function getSeaportCounter(seaportAddress: Address, offerer: Address): Promise<bigint> {
  return publicClient.readContract({
    address: seaportAddress,
    abi: seaportAbi,
    functionName: "getCounter",
    args: [offerer]
  });
}

export async function signTypedDataWithOperator(params: OperatorSignTypedDataParams): Promise<Hex> {
  return walletClient.signTypedData(params);
}

export { treasuryAbi };
export const operatorAccount = account;

interface AdaptiveSendParams {
  readonly to: Address;
  readonly value: bigint;
}

type WriteContractArgs = Parameters<typeof walletClient.writeContract>[0];

const FEE_MULTIPLIERS = [100n, 120n, 140n] as const;

async function sendTransactionWithAdaptiveFees(params: AdaptiveSendParams): Promise<Hex> {
  const nonce = await acquireNextNonce();
  let lastError: unknown = null;
  for (const multiplier of FEE_MULTIPLIERS) {
    try {
      const feeOverrides = await estimateFeeOverrides(multiplier);
      const hash = await walletClient.sendTransaction({
        to: params.to,
        value: params.value,
        account,
        nonce: Number(nonce),
        type: "eip1559",
        gasPrice: undefined,
        maxFeePerGas: feeOverrides.maxFeePerGas,
        maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas
      });
      incrementNonce();
      return hash;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : String(error);
      const isUnderpriced =
        message.includes("replacement transaction underpriced") ||
        message.includes("nonce too low") ||
        message.includes("fee too low") ||
        message.includes("max fee per gas less than block base fee");

      if (!isUnderpriced || multiplier === FEE_MULTIPLIERS[FEE_MULTIPLIERS.length - 1]) {
        throw error;
      }

      if (message.includes("nonce too low")) {
        resetNonceCache();
      }

      logger.warn(
        {
          attemptMultiplierBps: multiplier,
          nextMultiplierBps:
            multiplier === FEE_MULTIPLIERS[FEE_MULTIPLIERS.length - 1]
              ? null
              : FEE_MULTIPLIERS[FEE_MULTIPLIERS.indexOf(multiplier) + 1],
          reason: message
        },
        "Send transaction underpriced; retrying with higher fees"
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function writeContractWithAdaptiveFees(args: WriteContractArgs): Promise<Hex> {
  const nonce = await acquireNextNonce();
  let lastError: unknown = null;

  for (const multiplier of FEE_MULTIPLIERS) {
    try {
      const feeOverrides = await estimateFeeOverrides(multiplier);
      const hash = await walletClient.writeContract({
        ...args,
        nonce: Number(nonce),
        type: "eip1559",
        gasPrice: undefined,
        maxFeePerGas: feeOverrides.maxFeePerGas,
        maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas
      });
      incrementNonce();
      return hash;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : String(error);
      const isUnderpriced =
        message.includes("replacement transaction underpriced") ||
        message.includes("nonce too low") ||
        message.includes("fee too low") ||
        message.includes("max fee per gas less than block base fee");

      if (!isUnderpriced || multiplier === FEE_MULTIPLIERS[FEE_MULTIPLIERS.length - 1]) {
        throw error;
      }

      if (message.includes("nonce too low")) {
        resetNonceCache();
      }

      logger.warn(
        {
          attemptMultiplierBps: multiplier,
          nextMultiplierBps:
            multiplier === FEE_MULTIPLIERS[FEE_MULTIPLIERS.length - 1]
              ? null
              : FEE_MULTIPLIERS[FEE_MULTIPLIERS.indexOf(multiplier) + 1],
          reason: message
        },
        "Contract write underpriced; retrying with higher fees"
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function estimateFeeOverrides(multiplierBps: bigint): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  try {
    const fees = await publicClient.estimateFeesPerGas();
    const baseMaxFee = fees.maxFeePerGas;
    const basePriorityFee = fees.maxPriorityFeePerGas;
    if (baseMaxFee === undefined || basePriorityFee === undefined) {
      throw new Error("estimateFeesPerGas missing fields");
    }
    const maxFeePerGas = scaleFee(baseMaxFee, multiplierBps);
    const maxPriorityFeePerGas = scaleFee(basePriorityFee, multiplierBps);
    return { maxFeePerGas, maxPriorityFeePerGas };
  } catch {
    const gasPrice = await publicClient.getGasPrice();
    const adjusted = scaleFee(gasPrice, multiplierBps);
    return { maxFeePerGas: adjusted, maxPriorityFeePerGas: adjusted };
  }
}

function scaleFee(value: bigint, multiplierBps: bigint): bigint {
  return (value * multiplierBps + 99n) / 100n;
}

let cachedNonce: bigint | null = null;

async function acquireNextNonce(): Promise<bigint> {
  if (cachedNonce === null) {
    const rawNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending"
    });
    cachedNonce = typeof rawNonce === "bigint" ? rawNonce : BigInt(rawNonce);
  }
  return cachedNonce;
}

function incrementNonce(): void {
  if (cachedNonce !== null) {
    cachedNonce = cachedNonce + 1n;
  }
}

function resetNonceCache(): void {
  cachedNonce = null;
}
