import type { DailyStats, PollCycleRecord, SourceHealthStatus } from "./types.ts";
import { log } from "./logger.ts";

const POLL_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * KV-backed state manager for watchdog.
 *
 * Key schema:
 *   ["poll", <timestamp_ms>]            → PollCycleRecord     (TTL: 24h)
 *   ["stats", "daily", <YYYY-MM-DD>]   → DailyStats           (TTL: 7d)
 *   ["health", <projectRef>, <source>]  → SourceHealthStatus   (overwritten)
 *   ["meta", "last_poll"]               → { timestamp: string, ok: boolean }
 *   ["meta", "started_at"]              → { timestamp: string }
 *   ["meta", "schema_version"]          → number
 *   ["dedup", <fingerprint>]            → true                 (TTL: 24h)
 *   ["telegram", "last_update_id"]      → number
 */
export class WatchdogState {
  private kv: Deno.Kv | null = null;
  private available = false;

  async init(): Promise<void> {
    try {
      if (typeof Deno.openKv !== "function") {
        log.warn("kv_unavailable", { error: "Deno.openKv is not available. Local: run with --unstable-kv flag. Deno Deploy: attach a KV database in project settings (Settings > KV)." });
        this.available = false;
        return;
      }

      this.kv = await Deno.openKv();
      this.available = true;

      // Write schema version
      await this.kv.set(["meta", "schema_version"], 1);
      await this.kv.set(["meta", "started_at"], { timestamp: new Date().toISOString() });

      log.info("kv_initialized");
    } catch (err) {
      log.warn("kv_unavailable", { error: String(err) });
      this.available = false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  // ── Last poll time ──────────────────────────────────────────────

  async persistLastPollTime(timestamp: Date, ok: boolean): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.set(["meta", "last_poll"], {
        timestamp: timestamp.toISOString(),
        ok,
      });
    } catch (err) {
      log.warn("kv_write_failed", { key: "meta.last_poll", error: String(err) });
    }
  }

  async getLastPollTime(): Promise<{ timestamp: string; ok: boolean } | null> {
    if (!this.kv) return null;
    try {
      const entry = await this.kv.get<{ timestamp: string; ok: boolean }>(["meta", "last_poll"]);
      return entry.value;
    } catch {
      return null;
    }
  }

  // ── Poll cycle logging ──────────────────────────────────────────

  async logPollCycle(record: PollCycleRecord): Promise<void> {
    if (!this.kv) return;
    try {
      const key = ["poll", Date.parse(record.started_at)];
      await this.kv.set(key, record, { expireIn: POLL_TTL_MS });
    } catch (err) {
      log.warn("kv_write_failed", { key: "poll", error: String(err) });
    }
  }

  async getRecentPolls(limit = 20): Promise<PollCycleRecord[]> {
    if (!this.kv) return [];
    try {
      const entries = this.kv.list<PollCycleRecord>({ prefix: ["poll"] }, {
        limit,
        reverse: true,
      });
      const records: PollCycleRecord[] = [];
      for await (const entry of entries) {
        records.push(entry.value);
      }
      return records;
    } catch {
      return [];
    }
  }

  // ── Health matrix ───────────────────────────────────────────────

  async updateHealth(
    projectRef: string,
    source: string,
    ok: boolean,
    lastError?: string,
  ): Promise<void> {
    if (!this.kv) return;
    try {
      const status: SourceHealthStatus = {
        last_poll: new Date().toISOString(),
        ok,
        last_error: lastError,
      };
      await this.kv.set(["health", projectRef, source], status);
    } catch (err) {
      log.warn("kv_write_failed", { key: `health.${projectRef}.${source}`, error: String(err) });
    }
  }

  async getHealthMatrix(): Promise<Map<string, Map<string, SourceHealthStatus>>> {
    if (!this.kv) return new Map();
    try {
      const matrix = new Map<string, Map<string, SourceHealthStatus>>();
      const entries = this.kv.list<SourceHealthStatus>({ prefix: ["health"] });
      for await (const entry of entries) {
        const [, projectRef, source] = entry.key as [string, string, string];
        if (!matrix.has(projectRef)) {
          matrix.set(projectRef, new Map());
        }
        matrix.get(projectRef)!.set(source, entry.value);
      }
      return matrix;
    } catch {
      return new Map();
    }
  }

  // ── Daily stats ─────────────────────────────────────────────────

  async updateDailyStats(errorsFound: number, alertsSent: number): Promise<void> {
    if (!this.kv) return;
    try {
      const dateKey = new Date().toISOString().slice(0, 10);
      const key = ["stats", "daily", dateKey];
      const existing = await this.kv.get<DailyStats>(key);
      const current = existing.value || { polls: 0, errors_found: 0, alerts_sent: 0 };

      const updated: DailyStats = {
        polls: current.polls + 1,
        errors_found: current.errors_found + errorsFound,
        alerts_sent: current.alerts_sent + alertsSent,
      };

      await this.kv.set(key, updated, { expireIn: STATS_TTL_MS });
    } catch (err) {
      log.warn("kv_write_failed", { key: "stats.daily", error: String(err) });
    }
  }

  async getDailyStats(): Promise<DailyStats> {
    if (!this.kv) return { polls: 0, errors_found: 0, alerts_sent: 0 };
    try {
      const dateKey = new Date().toISOString().slice(0, 10);
      const entry = await this.kv.get<DailyStats>(["stats", "daily", dateKey]);
      return entry.value || { polls: 0, errors_found: 0, alerts_sent: 0 };
    } catch {
      return { polls: 0, errors_found: 0, alerts_sent: 0 };
    }
  }

  // ── Deduplication ───────────────────────────────────────────────

  async checkDedupSeen(fingerprint: string): Promise<boolean> {
    if (!this.kv) return false;
    try {
      const entry = await this.kv.get(["dedup", fingerprint]);
      return entry.value !== null;
    } catch {
      return false;
    }
  }

  async setDedupSeen(fingerprint: string): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.set(["dedup", fingerprint], true, { expireIn: DEDUP_TTL_MS });
    } catch (err) {
      log.warn("kv_write_failed", { key: `dedup.${fingerprint}`, error: String(err) });
    }
  }

  // ── Telegram update tracking ────────────────────────────────────

  async getLastUpdateId(): Promise<number> {
    if (!this.kv) return 0;
    try {
      const entry = await this.kv.get<number>(["telegram", "last_update_id"]);
      return entry.value || 0;
    } catch {
      return 0;
    }
  }

  async setLastUpdateId(updateId: number): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.set(["telegram", "last_update_id"], updateId);
    } catch (err) {
      log.warn("kv_write_failed", { key: "telegram.last_update_id", error: String(err) });
    }
  }

  // ── Startup metadata ───────────────────────────────────────────

  async getStartedAt(): Promise<string | null> {
    if (!this.kv) return null;
    try {
      const entry = await this.kv.get<{ timestamp: string }>(["meta", "started_at"]);
      return entry.value?.timestamp ?? null;
    } catch {
      return null;
    }
  }

  /** Close the KV connection. Call in tests to avoid resource leaks. */
  close(): void {
    if (this.kv) {
      this.kv.close();
      this.kv = null;
      this.available = false;
    }
  }
}
