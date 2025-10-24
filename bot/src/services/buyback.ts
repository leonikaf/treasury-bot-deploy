import { encodeFunctionData } from "viem";
import {
  ACTION_COOLDOWN_MS,
  BUYBACK_CHUNK_WEI,
  BUYBACK_ROUTER_ADDRESS,
  BURN_ADDRESS,
  TOKEN_ADDRESS,
  TREASURY_ADDRESS,
  WETH_ADDRESS
} from "../config.js";
import type { BotState } from "../types.js";
import { StateStore } from "../state/stateStore.js";
import { publicClient, executeSeaport, waitForReceipt } from "../treasuryClient.js";
import { logger } from "../utils/logger.js";
import { delay } from "../utils/time.js";

const SWAP_FUNCTION_ABI = {
  type: "function",
  name: "swapExactETHForTokensSupportingFeeOnTransferTokens",
  inputs: [
    { name: "amountOutMin", type: "uint256" },
    { name: "path", type: "address[]" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" }
  ]
} as const;

const BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

const TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
] as const;

const TREASURY_ROUTERS_ABI = [
  {
    type: "function",
    name: "routers",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }]
  }
] as const;

async function completePendingBurn(
  stateStore: StateStore,
  state: BotState,
  spentWeiOverride?: bigint
): Promise<void> {
  if (state.pendingBurnAmount <= 0n) {
    return;
  }

  if (!TOKEN_ADDRESS) {
    throw new Error("TOKEN_ADDRESS is not configured");
  }

  const burnAmount = state.pendingBurnAmount;
  const burnCalldata = encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: "transfer",
    args: [BURN_ADDRESS, burnAmount]
  });

  const burnTx = await executeSeaport({
    router: TOKEN_ADDRESS,
    valueWei: 0n,
    calldata: burnCalldata,
    callValueWei: 0n
  });
  logger.info({ amount: burnAmount.toString(), txHash: burnTx }, "Submitted burn transfer");
  await waitForReceipt(burnTx);

  const costSource = spentWeiOverride ?? state.pendingBurnCostWei;
  const costToDeduct =
    costSource > 0n
      ? state.salePoolWei >= costSource
        ? costSource
        : state.salePoolWei
      : 0n;

  state.pendingBurnAmount = 0n;
  state.pendingBurnCostWei = 0n;

  if (costToDeduct > 0n) {
    state.salePoolWei -= costToDeduct;
  }

  await stateStore.save();

  logger.info(
    {
      spentWei: costToDeduct.toString(),
      burnedAmount: burnAmount.toString(),
      remainingSalePool: state.salePoolWei.toString()
    },
    "Buyback and burn completed"
  );
}

export async function performBuybackAndBurn(stateStore: StateStore): Promise<boolean> {
  if (!TOKEN_ADDRESS || !BUYBACK_ROUTER_ADDRESS || !WETH_ADDRESS) {
    return false;
  }

  const state = stateStore.getState();

  if (state.pendingBurnAmount > 0n) {
    logger.info(
      {
        pendingAmount: state.pendingBurnAmount.toString(),
        pendingCostWei: state.pendingBurnCostWei.toString()
      },
      "Retrying pending burn transfer"
    );
    await completePendingBurn(stateStore, state);
    if (ACTION_COOLDOWN_MS > 0) {
      await delay(ACTION_COOLDOWN_MS);
    }
    return true;
  }

  if (state.salePoolWei <= 0n) {
    return false;
  }

  const amountToUse =
    BUYBACK_CHUNK_WEI && BUYBACK_CHUNK_WEI > 0n
      ? state.salePoolWei < BUYBACK_CHUNK_WEI
        ? state.salePoolWei
        : BUYBACK_CHUNK_WEI
      : state.salePoolWei;

  if (amountToUse <= 0n) {
    return false;
  }

  const tokenRouterAllowed = await publicClient.readContract({
    address: TREASURY_ADDRESS,
    abi: TREASURY_ROUTERS_ABI,
    functionName: "routers",
    args: [TOKEN_ADDRESS]
  });
  if (!tokenRouterAllowed) {
    logger.error(
      { token: TOKEN_ADDRESS },
      "Treasury contract is not authorized to execute through token address; cannot burn"
    );
    return false;
  }

  const balanceBefore = await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [TREASURY_ADDRESS]
  });

  const swapCalldata = encodeFunctionData({
    abi: [SWAP_FUNCTION_ABI],
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [
      0n,
      [WETH_ADDRESS, TOKEN_ADDRESS],
      TREASURY_ADDRESS,
      BigInt(Math.floor(Date.now() / 1000) + 15 * 60)
    ]
  });

  const swapTx = await executeSeaport({
    router: BUYBACK_ROUTER_ADDRESS,
    valueWei: amountToUse,
    calldata: swapCalldata,
    callValueWei: 0n
  });
  logger.info({ amountWei: amountToUse.toString(), txHash: swapTx }, "Submitted buyback swap");
  await waitForReceipt(swapTx);

  let balanceAfter = balanceBefore;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    balanceAfter = await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [TREASURY_ADDRESS],
      blockTag: "latest"
    });

    if (balanceAfter > balanceBefore) {
      break;
    }

    if (attempt < 2) {
      await delay(1_000);
    }
  }

  const purchasedAmount = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0n;
  if (purchasedAmount === 0n) {
    logger.warn("Buyback swap completed but no tokens were received");
    state.pendingBurnAmount = 0n;
    state.pendingBurnCostWei = 0n;
    state.salePoolWei = state.salePoolWei >= amountToUse ? state.salePoolWei - amountToUse : 0n;
    await stateStore.save();
    return true;
  }

  state.pendingBurnAmount = purchasedAmount;
  state.pendingBurnCostWei = amountToUse;
  await stateStore.save();

  await completePendingBurn(stateStore, state, amountToUse);

  if (ACTION_COOLDOWN_MS > 0) {
    await delay(ACTION_COOLDOWN_MS);
  }

  return true;
}
