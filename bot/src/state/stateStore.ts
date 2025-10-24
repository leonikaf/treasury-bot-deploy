import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ActiveListingState, BotState } from "../types.js";

const STATE_VERSION = 3;

interface StateRow {
  readonly version: number;
  readonly commissionPoolWei: string;
  readonly salePoolWei: string;
  readonly lastTaxBlock: string;
  readonly pendingBurnAmount: string;
  readonly pendingBurnCostWei: string;
}

interface ListingRow {
  readonly orderHash: string;
  readonly collection: string;
  readonly tokenId: string;
  readonly expectedProceedsWei: string;
  readonly listedAtMs: number;
  readonly tokenStandard?: string | null;
  readonly listedQuantity?: string | null;
  readonly expectedPostSaleBalance?: string | null;
}

export class StateStore {
  private readonly dbPath: string;
  private readonly legacyJsonPath: string | null;
  private db: Database.Database | null = null;
  private state: BotState | null = null;

  constructor(dbFile: string, legacyJsonFile: string | null = null) {
    this.dbPath = resolve(dbFile);
    this.legacyJsonPath = legacyJsonFile ? resolve(legacyJsonFile) : null;
  }

  public getState(): BotState {
    if (!this.state) {
      throw new Error("State has not been loaded");
    }
    return this.state;
  }

  public async load(initialBlock: bigint): Promise<void> {
    await this.ensureDirectory();

    const dbAlreadyExists = existsSync(this.dbPath);
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.setupSchema();

    let loadedState = this.readStateFromDatabase();

    if (!loadedState) {
      if (!dbAlreadyExists) {
        loadedState = await this.tryLoadFromLegacyJson();
      }

      if (!loadedState) {
        loadedState = this.createDefaultState(initialBlock);
      }

      this.state = loadedState;
      this.persistState();
    } else {
      this.state = loadedState;
    }
  }

  public async save(): Promise<void> {
    if (!this.state) {
      throw new Error("State has not been loaded");
    }
    await Promise.resolve();
    this.persistState();
  }

  public updateListings(updater: (listings: ActiveListingState[]) => ActiveListingState[]): void {
    if (!this.state) {
      throw new Error("State has not been loaded");
    }
    this.state.activeListings = updater(this.state.activeListings);
  }

  private async ensureDirectory(): Promise<void> {
    const directory = dirname(this.dbPath);
    if (!existsSync(directory)) {
      await mkdir(directory, { recursive: true });
    }
  }

  private setupSchema(): void {
    if (!this.db) {
      throw new Error("Database connection has not been initialized");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        commissionPoolWei TEXT NOT NULL,
        salePoolWei TEXT NOT NULL,
        lastTaxBlock TEXT NOT NULL,
        pendingBurnAmount TEXT NOT NULL DEFAULT '0',
        pendingBurnCostWei TEXT NOT NULL DEFAULT '0'
      );

      CREATE TABLE IF NOT EXISTS listings (
        orderHash TEXT PRIMARY KEY,
        collection TEXT NOT NULL,
        tokenId TEXT NOT NULL,
        expectedProceedsWei TEXT NOT NULL,
        listedAtMs INTEGER NOT NULL,
        tokenStandard TEXT NOT NULL DEFAULT 'erc721',
        listedQuantity TEXT NOT NULL DEFAULT '1',
        expectedPostSaleBalance TEXT
      );
    `);

    this.ensureStateColumns();
    this.ensureListingColumns();
  }

  private readStateFromDatabase(): BotState | null {
    if (!this.db) {
      throw new Error("Database connection has not been initialized");
    }

    const stateRow = this.db
      .prepare(
        `SELECT
          version,
          commissionPoolWei,
          salePoolWei,
          lastTaxBlock,
          pendingBurnAmount,
          pendingBurnCostWei
        FROM state WHERE id = 1`
      )
      .get() as StateRow | undefined;

    if (!stateRow) {
      return null;
    }

    const storedVersion = stateRow.version ?? STATE_VERSION;
    const normalizedVersion = storedVersion < STATE_VERSION ? STATE_VERSION : storedVersion;

    const listings = this.db
      .prepare(
        `
          SELECT
            orderHash,
            collection,
            tokenId,
            expectedProceedsWei,
            listedAtMs,
            tokenStandard,
            listedQuantity,
            expectedPostSaleBalance
          FROM listings
          ORDER BY listedAtMs ASC
        `
      )
      .all() as ListingRow[];

    return {
      version: normalizedVersion,
      commissionPoolWei: BigInt(stateRow.commissionPoolWei),
      salePoolWei: BigInt(stateRow.salePoolWei),
      pendingBurnAmount: BigInt(stateRow.pendingBurnAmount ?? "0"),
      pendingBurnCostWei: BigInt(stateRow.pendingBurnCostWei ?? "0"),
      lastTaxBlock: BigInt(stateRow.lastTaxBlock ?? "0"),
      activeListings: listings.map((row) => ({
        orderHash: row.orderHash,
        collection: row.collection as ActiveListingState["collection"],
        tokenId: row.tokenId,
        expectedProceedsWei: BigInt(row.expectedProceedsWei),
        listedAtMs: row.listedAtMs,
        tokenStandard: (row.tokenStandard ?? "erc721") === "erc1155" ? "erc1155" : "erc721",
        listedQuantity: BigInt(row.listedQuantity ?? "1"),
        expectedPostSaleBalance:
          row.expectedPostSaleBalance !== null && row.expectedPostSaleBalance !== undefined
            ? BigInt(row.expectedPostSaleBalance)
            : null
      }))
    };
  }

  private persistState(): void {
    if (!this.db) {
      throw new Error("Database connection has not been initialized");
    }
    if (!this.state) {
      throw new Error("State has not been loaded");
    }

    const db = this.db;
    const transaction = db.transaction((state: BotState) => {
      const upsertState = db.prepare(
        `
          INSERT INTO state (
            id,
            version,
            commissionPoolWei,
            salePoolWei,
            lastTaxBlock,
            pendingBurnAmount,
            pendingBurnCostWei
          )
          VALUES (
            1,
            @version,
            @commissionPoolWei,
            @salePoolWei,
            @lastTaxBlock,
            @pendingBurnAmount,
            @pendingBurnCostWei
          )
          ON CONFLICT(id) DO UPDATE SET
            version = excluded.version,
            commissionPoolWei = excluded.commissionPoolWei,
            salePoolWei = excluded.salePoolWei,
            lastTaxBlock = excluded.lastTaxBlock,
            pendingBurnAmount = excluded.pendingBurnAmount,
            pendingBurnCostWei = excluded.pendingBurnCostWei
        `
      );

      upsertState.run({
        version: STATE_VERSION,
        commissionPoolWei: state.commissionPoolWei.toString(),
        salePoolWei: state.salePoolWei.toString(),
        lastTaxBlock: state.lastTaxBlock.toString(),
        pendingBurnAmount: state.pendingBurnAmount.toString(),
        pendingBurnCostWei: state.pendingBurnCostWei.toString()
      });

      db.prepare("DELETE FROM listings").run();

      if (state.activeListings.length > 0) {
        const insertListing = db.prepare(
          `
            INSERT INTO listings (
              orderHash,
              collection,
              tokenId,
              expectedProceedsWei,
              listedAtMs,
              tokenStandard,
              listedQuantity,
              expectedPostSaleBalance
            )
            VALUES (
              @orderHash,
              @collection,
              @tokenId,
              @expectedProceedsWei,
              @listedAtMs,
              @tokenStandard,
              @listedQuantity,
              @expectedPostSaleBalance
            )
          `
        );

        for (const listing of state.activeListings) {
          insertListing.run({
            orderHash: listing.orderHash,
            collection: listing.collection,
            tokenId: listing.tokenId,
            expectedProceedsWei: listing.expectedProceedsWei.toString(),
            listedAtMs: listing.listedAtMs,
            tokenStandard: listing.tokenStandard,
            listedQuantity: listing.listedQuantity.toString(),
            expectedPostSaleBalance:
              listing.expectedPostSaleBalance !== null
                ? listing.expectedPostSaleBalance.toString()
                : null
          });
        }
      }
    });

    transaction(this.state);
  }

  private ensureListingColumns(): void {
    if (!this.db) {
      throw new Error("Database connection has not been initialized");
    }

    const columns = this.db
      .prepare("PRAGMA table_info(listings)")
      .all() as { name: string }[];
    const existing = new Set(columns.map((column) => column.name));

    if (!existing.has("tokenStandard")) {
      this.db.exec("ALTER TABLE listings ADD COLUMN tokenStandard TEXT NOT NULL DEFAULT 'erc721'");
    }
    if (!existing.has("listedQuantity")) {
      this.db.exec("ALTER TABLE listings ADD COLUMN listedQuantity TEXT NOT NULL DEFAULT '1'");
    }
    if (!existing.has("expectedPostSaleBalance")) {
      this.db.exec("ALTER TABLE listings ADD COLUMN expectedPostSaleBalance TEXT");
    }
  }

  private ensureStateColumns(): void {
    if (!this.db) {
      throw new Error("Database connection has not been initialized");
    }

    const columns = this.db.prepare("PRAGMA table_info(state)").all() as { name: string }[];
    const existing = new Set(columns.map((column) => column.name));

    if (!existing.has("pendingBurnAmount")) {
      this.db.exec("ALTER TABLE state ADD COLUMN pendingBurnAmount TEXT NOT NULL DEFAULT '0'");
    }
    if (!existing.has("pendingBurnCostWei")) {
      this.db.exec("ALTER TABLE state ADD COLUMN pendingBurnCostWei TEXT NOT NULL DEFAULT '0'");
    }
  }

  private createDefaultState(initialBlock: bigint): BotState {
    return {
      version: STATE_VERSION,
      commissionPoolWei: 0n,
      salePoolWei: 0n,
      pendingBurnAmount: 0n,
      pendingBurnCostWei: 0n,
      activeListings: [],
      lastTaxBlock: initialBlock
    };
  }

  private async tryLoadFromLegacyJson(): Promise<BotState | null> {
    if (!this.legacyJsonPath) {
      return null;
    }

    try {
      const raw = await readFile(this.legacyJsonPath, "utf8");
      const parsed = JSON.parse(raw) as LegacySerializedState;
      return deserializeLegacyState(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}

interface LegacySerializedListing {
  readonly orderHash: string;
  readonly collection: string;
  readonly tokenId: string;
  readonly expectedProceedsWei: string;
  readonly listedAtMs: number;
  readonly tokenStandard?: string;
  readonly listedQuantity?: string;
  readonly expectedPostSaleBalance?: string | null;
}

interface LegacySerializedState {
  readonly version?: number;
  readonly commissionPoolWei: string;
  readonly salePoolWei: string;
  readonly activeListings?: LegacySerializedListing[];
  readonly lastTaxBlock?: string;
  readonly pendingBurnAmount?: string;
  readonly pendingBurnCostWei?: string;
}

function deserializeLegacyState(raw: LegacySerializedState): BotState {
  const initialVersion = raw.version ?? STATE_VERSION;
  const normalizedVersion = initialVersion < STATE_VERSION ? STATE_VERSION : initialVersion;

  return {
    version: normalizedVersion,
    commissionPoolWei: BigInt(raw.commissionPoolWei ?? "0"),
    salePoolWei: BigInt(raw.salePoolWei ?? "0"),
    pendingBurnAmount: BigInt(raw.pendingBurnAmount ?? "0"),
    pendingBurnCostWei: BigInt(raw.pendingBurnCostWei ?? "0"),
    lastTaxBlock: BigInt(raw.lastTaxBlock ?? "0"),
    activeListings: (raw.activeListings ?? []).map((listing) => ({
      orderHash: listing.orderHash,
      collection: listing.collection as ActiveListingState["collection"],
      tokenId: listing.tokenId,
      expectedProceedsWei: BigInt(listing.expectedProceedsWei),
      listedAtMs: listing.listedAtMs,
      tokenStandard:
        listing.tokenStandard && listing.tokenStandard.toLowerCase() === "erc1155"
          ? "erc1155"
          : "erc721",
      listedQuantity: BigInt(listing.listedQuantity ?? "1"),
      expectedPostSaleBalance:
        listing.expectedPostSaleBalance !== null && listing.expectedPostSaleBalance !== undefined
          ? BigInt(listing.expectedPostSaleBalance)
          : null
    }))
  };
}
