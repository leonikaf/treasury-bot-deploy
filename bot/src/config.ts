import { config as loadEnv } from "dotenv";
import { z } from "zod";

import type { Address, Hex } from "./types.js";

loadEnv();

const addressRegex = /^0x[a-fA-F0-9]{40}$/;
const privateKeyRegex = /^0x[a-fA-F0-9]{64}$/;
const hexDataRegex = /^0x([a-fA-F0-9]{2})*$/;

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const envSchema = z.object({
  RPC_URL: z.string().url(),
  TREASURY_ADDRESS: z.string().regex(addressRegex),
  OPERATOR_PRIVATE_KEY: z.string().regex(privateKeyRegex),
  DRY_RUN: z.preprocess(emptyToUndefined, z.string().optional()),
  SEAPORT_ROUTER: z.preprocess(emptyToUndefined, z.string().regex(addressRegex).optional()),
  TARGET_COLLECTION: z.preprocess(emptyToUndefined, z.string().regex(addressRegex).optional()),
  TARGET_COLLECTION_SLUG: z.preprocess(emptyToUndefined, z.string().optional()),
  TARGET_TOKEN_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENSEA_API_URL: z
    .preprocess(emptyToUndefined, z.string().url().optional())
    .default("https://api.opensea.io"),
  OPENSEA_API_KEY: z.preprocess(emptyToUndefined, z.string()),
  EXECUTE_ROUTER: z.preprocess(
    emptyToUndefined,
    z.string().regex(addressRegex).optional()
  ),
  EXECUTE_CALLDATA: z.preprocess(
    emptyToUndefined,
    z.string().regex(hexDataRegex).optional()
  ),
  EXECUTE_VALUE_WEI: z.preprocess(emptyToUndefined, z.coerce.bigint().optional()),
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.string().optional()),
  CHAIN_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  TOKEN_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(addressRegex).optional()),
  BUYBACK_ROUTER_ADDRESS: z
    .preprocess(emptyToUndefined, z.string().regex(addressRegex).optional()),
  WETH_ADDRESS: z.preprocess(emptyToUndefined, z.string().regex(addressRegex).optional()),
  BURN_ADDRESS: z
    .preprocess(emptyToUndefined, z.string().regex(addressRegex).optional())
    .default("0x000000000000000000000000000000000000dEaD"),
  STATE_FILE: z.preprocess(emptyToUndefined, z.string().optional()),
  STATE_DB_FILE: z.preprocess(emptyToUndefined, z.string().optional()),
  LOOP_INTERVAL_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  ACTION_COOLDOWN_MS: z
    .preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional()),
  BUYBACK_CHUNK_WEI: z.preprocess(emptyToUndefined, z.coerce.bigint().optional()),
  MAX_LISTING_CHECKS_PER_TICK: z
    .preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  LOG_FETCH_THROTTLE_MS: z
    .preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional())
});

const env = envSchema.parse(process.env);

export const RPC_URL = env.RPC_URL;
export const TREASURY_ADDRESS = env.TREASURY_ADDRESS as Address;
export const OPERATOR_PRIVATE_KEY = env.OPERATOR_PRIVATE_KEY as Hex;
export const DRY_RUN =
  env.DRY_RUN === undefined || !["0", "false"].includes(env.DRY_RUN.toLowerCase());
export const SEAPORT_ROUTER = env.SEAPORT_ROUTER ? (env.SEAPORT_ROUTER as Address) : null;
export const LOG_LEVEL = env.LOG_LEVEL ?? "info";
export const CHAIN_ID = env.CHAIN_ID ?? null;
export const EXECUTE_ROUTER = env.EXECUTE_ROUTER ? (env.EXECUTE_ROUTER as Address) : null;
export const EXECUTE_CALLDATA = env.EXECUTE_CALLDATA ? (env.EXECUTE_CALLDATA as Hex) : null;
export const EXECUTE_VALUE_WEI = env.EXECUTE_VALUE_WEI ?? null;
export const TARGET_COLLECTION = env.TARGET_COLLECTION ? (env.TARGET_COLLECTION as Address) : null;
export const TARGET_COLLECTION_SLUG = env.TARGET_COLLECTION_SLUG ?? null;
export const TARGET_TOKEN_ID = env.TARGET_TOKEN_ID ?? null;
export const OPENSEA_API_URL = env.OPENSEA_API_URL;
export const OPENSEA_API_KEY = env.OPENSEA_API_KEY;
export const TOKEN_ADDRESS = env.TOKEN_ADDRESS ? (env.TOKEN_ADDRESS as Address) : null;
export const BUYBACK_ROUTER_ADDRESS = env.BUYBACK_ROUTER_ADDRESS
  ? (env.BUYBACK_ROUTER_ADDRESS as Address)
  : null;
export const WETH_ADDRESS = env.WETH_ADDRESS ? (env.WETH_ADDRESS as Address) : null;
export const BURN_ADDRESS = env.BURN_ADDRESS as Address;
const legacyStateFile = env.STATE_FILE ?? "bot-state.json";
const deriveStateDatabasePath = (legacyPath: string | null): string => {
  if (!legacyPath) {
    return "bot-state.db";
  }
  if (legacyPath.toLowerCase().endsWith(".json")) {
    return legacyPath.replace(/\.json$/i, ".db");
  }
  return `${legacyPath}.db`;
};

export const LEGACY_STATE_FILE = legacyStateFile;
export const STATE_DB_FILE = env.STATE_DB_FILE ?? deriveStateDatabasePath(legacyStateFile);
export const STATE_FILE = STATE_DB_FILE;
export const LOOP_INTERVAL_MS = env.LOOP_INTERVAL_MS ?? 15_000;
export const ACTION_COOLDOWN_MS = env.ACTION_COOLDOWN_MS ?? 5_000;
export const BUYBACK_CHUNK_WEI = env.BUYBACK_CHUNK_WEI ?? null;
export const MAX_LISTING_CHECKS_PER_TICK = env.MAX_LISTING_CHECKS_PER_TICK ?? 3;
export const LOG_FETCH_THROTTLE_MS = env.LOG_FETCH_THROTTLE_MS ?? 0;
