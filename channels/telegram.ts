import type {
  Channel,
  ErrorEvent,
  ProcessedEvent,
  Processor,
  Source,
  WatchdogConfig,
} from "../types.ts";
import { parseDuration } from "../config.ts";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;
const RATE_LIMIT_DELAY_MS = 3000; // ~20 msg/min = 1 msg per 3s

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// --- Source-specific metadata rendering ---

function metadataLine(
  label: string,
  value: unknown,
  formatter?: (v: string) => string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  const str = String(value);
  if (formatter) return `<b>${escapeHtml(label)}:</b> ${formatter(str)}`;
  return `<b>${escapeHtml(label)}:</b> ${escapeHtml(str)}`;
}

const codeFmt = (v: string) => `<code>${escapeHtml(v)}</code>`;

type MetadataRenderer = (m: Record<string, unknown>) => string[];

const SOURCE_METADATA_RENDERERS: Record<string, MetadataRenderer> = {
  edge_logs: (m) =>
    [
      metadataLine("Method", m.method),
      metadataLine("Path", m.path, codeFmt),
    ].filter((line): line is string => line !== null),

  auth_logs: (m) =>
    [
      metadataLine("Path", m.path, codeFmt),
      metadataLine("Level", m.level),
    ].filter((line): line is string => line !== null),

  postgres_logs: (m) =>
    [
      metadataLine("Severity", m.error_severity),
      metadataLine("SQL State", m.sql_state_code, codeFmt),
      metadataLine("User", m.user_name, codeFmt),
      metadataLine("Application", m.application_name),
      metadataLine("Detail", m.detail),
      metadataLine("Hint", m.hint),
      metadataLine("Query", m.query, codeFmt),
    ].filter((line): line is string => line !== null),

  storage_logs: (m) =>
    [
      metadataLine("Level", m.level),
    ].filter((line): line is string => line !== null),

  realtime_logs: (m) =>
    [
      metadataLine("Level", m.level),
    ].filter((line): line is string => line !== null),

  supavisor_logs: (m) =>
    [
      metadataLine("Level", m.level),
    ].filter((line): line is string => line !== null),
};

const FALLBACK_METADATA_RENDERER: MetadataRenderer = (m) =>
  Object.entries(m)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 5)
    .map(([key, value]) =>
      `<b>${escapeHtml(key)}:</b> ${escapeHtml(String(value))}`
    );

// --- Telegram update types ---

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

// --- Bot dependencies ---

export interface BotDeps {
  /** The source instance for on-demand polling. */
  source: Source;
  /** The processor instance for processing events. */
  processor: Processor;
  /** Accessor for the current lastPollTime. */
  getLastPollTime: () => Date;
  /** The loaded config for project info. */
  config: WatchdogConfig;
}

// --- Channel implementation ---

export class TelegramChannel implements Channel {
  readonly name = "telegram";

  private botToken: string;
  private chatId: string;
  private maxAlerts: number;

  private deps: BotDeps | null = null;
  private updateOffset = 0;

  constructor(config: WatchdogConfig) {
    const telegram = config.channels.telegram;
    if (!telegram) {
      throw new Error("Telegram channel config is missing");
    }
    this.botToken = telegram.bot_token;
    this.chatId = telegram.chat_id;
    this.maxAlerts = config.filters.max_alerts_per_interval;
  }

  async send(events: ProcessedEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Enforce alert cap
    const capped = events.slice(0, this.maxAlerts);
    const dropped = events.length - capped.length;

    for (let i = 0; i < capped.length; i++) {
      const message = this.formatEvent(capped[i]!);
      await this.sendMessage(message);

      // Rate limiting: wait between messages (except after the last one)
      if (i < capped.length - 1) {
        await delay(RATE_LIMIT_DELAY_MS);
      }
    }

    // If events were dropped, send a summary message
    if (dropped > 0) {
      await delay(RATE_LIMIT_DELAY_MS);
      await this.sendMessage(
        `⚠️ <b>${dropped} additional alert(s)</b> were suppressed (max ${this.maxAlerts} per interval).`,
      );
    }
  }

  // --- Bot polling ---

  startPolling(deps: BotDeps): void {
    this.deps = deps;
    this.pollUpdates();
    console.log("[watchdog] Telegram bot polling started");
  }

  private async pollUpdates(): Promise<void> {
    while (true) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.updateOffset = update.update_id + 1;
          if (update.message?.text) {
            await this.handleCommand(update.message);
          }
        }
      } catch (error) {
        console.warn(`[watchdog] Bot polling error: ${error}`);
        await delay(5000);
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: this.updateOffset,
        timeout: 30,
        allowed_updates: ["message"],
      }),
    });

    if (!response.ok) {
      throw new Error(`getUpdates failed (${response.status})`);
    }

    const body = await response.json() as {
      ok: boolean;
      result: TelegramUpdate[];
    };
    return body.result ?? [];
  }

  // --- Command dispatcher ---

  private async handleCommand(message: TelegramMessage): Promise<void> {
    const text = message.text?.trim() ?? "";
    const chatId = String(message.chat.id);

    // Only respond to commands (starting with /)
    if (!text.startsWith("/")) return;

    // Strip @botname suffix from commands (e.g. /check@MyBot -> /check)
    const [rawCommand, ...args] = text.split(/\s+/);
    const command = rawCommand!.replace(/@\S+$/, "");

    try {
      switch (command) {
        case "/check":
          await this.handleCheck(chatId, args);
          break;
        case "/errors":
          await this.handleErrors(chatId, args);
          break;
        case "/status":
          await this.handleStatus(chatId);
          break;
        case "/start":
        case "/help":
          await this.handleHelp(chatId);
          break;
        default:
          await this.sendMessageTo(
            chatId,
            `Unknown command: <code>${escapeHtml(command)}</code>\nType /help for available commands.`,
          );
      }
    } catch (error) {
      console.error(`[watchdog] Command ${command} failed: ${error}`);
      await this.sendMessageTo(
        chatId,
        `Command failed: ${escapeHtml(String(error))}`,
      );
    }
  }

  // --- Command handlers ---

  private async handleCheck(chatId: string, args: string[]): Promise<void> {
    const deps = this.deps!;
    const projectFilter = args.join(" ").trim() || null;

    await this.sendMessageTo(chatId, "Checking for errors...");

    const since = deps.getLastPollTime();
    const events = await deps.source.poll(since);

    // Filter to specific project if requested
    let filtered = events;
    if (projectFilter) {
      const lower = projectFilter.toLowerCase();
      filtered = events.filter(
        (e) =>
          e.project.toLowerCase() === lower ||
          e.projectRef.toLowerCase() === lower,
      );

      if (filtered.length === 0 && events.length > 0) {
        const known = deps.config.projects.some(
          (p) =>
            p.name.toLowerCase() === lower ||
            p.ref.toLowerCase() === lower,
        );
        if (!known) {
          await this.sendMessageTo(
            chatId,
            `Unknown project: <code>${escapeHtml(projectFilter)}</code>\n\nKnown projects:\n${deps.config.projects.map((p) => `• ${escapeHtml(p.name)} (<code>${p.ref}</code>)`).join("\n")}`,
          );
          return;
        }
      }
    }

    if (filtered.length === 0) {
      const scope = projectFilter
        ? `for ${escapeHtml(projectFilter)}`
        : "across all projects";
      await this.sendMessageTo(chatId, `No errors found ${scope}.`);
      return;
    }

    // Deduplicate, process, and send
    const unique = this.deduplicateEvents(filtered);
    const processed = await deps.processor.process(unique);
    await this.sendEventsToChat(chatId, processed);
  }

  private async handleErrors(chatId: string, args: string[]): Promise<void> {
    const deps = this.deps!;
    const timeframeArg = args[0];

    if (!timeframeArg) {
      await this.sendMessageTo(
        chatId,
        "Usage: <code>/errors &lt;timeframe&gt;</code>\nExamples: <code>/errors 30m</code>, <code>/errors 2h</code>",
      );
      return;
    }

    let durationMs: number;
    try {
      durationMs = parseDuration(timeframeArg, { noMinimum: true });
    } catch {
      await this.sendMessageTo(
        chatId,
        `Invalid timeframe: <code>${escapeHtml(timeframeArg)}</code>\nExamples: <code>30m</code>, <code>2h</code>, <code>1h30m</code>`,
      );
      return;
    }

    await this.sendMessageTo(
      chatId,
      `Fetching errors from the last ${escapeHtml(timeframeArg)}...`,
    );

    const since = new Date(Date.now() - durationMs);
    const events = await deps.source.poll(since);

    if (events.length === 0) {
      await this.sendMessageTo(
        chatId,
        `No errors in the last ${escapeHtml(timeframeArg)}.`,
      );
      return;
    }

    const unique = this.deduplicateEvents(events);
    const processed = await deps.processor.process(unique);
    await this.sendEventsToChat(chatId, processed);
  }

  private async handleStatus(chatId: string): Promise<void> {
    const deps = this.deps!;
    const lastPoll = deps.getLastPollTime();
    const projects = deps.config.projects;
    const sources = deps.config.polling.sources;

    const lines = [
      "<b>Watchdog Status</b>",
      "",
      `<b>Projects:</b> ${projects.length}`,
      ...projects.map(
        (p) => `  • ${escapeHtml(p.name)} (<code>${p.ref}</code>)`,
      ),
      "",
      `<b>Log sources:</b> ${sources.length}`,
      `<b>Polling interval:</b> ${escapeHtml(deps.config.polling.interval)}`,
      `<b>Last poll:</b> ${lastPoll.toISOString()}`,
    ];

    await this.sendMessageTo(chatId, lines.join("\n"));
  }

  private async handleHelp(chatId: string): Promise<void> {
    const lines = [
      "<b>Watchdog Commands</b>",
      "",
      "<code>/check</code> — Poll all projects for errors now",
      "<code>/check &lt;project&gt;</code> — Poll a specific project",
      "<code>/errors &lt;timeframe&gt;</code> — Errors from last N minutes/hours",
      "<code>/status</code> — Show monitoring status",
      "<code>/help</code> — Show this message",
    ];

    await this.sendMessageTo(chatId, lines.join("\n"));
  }

  // --- Helper methods ---

  private async sendMessageTo(chatId: string, text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `[watchdog] Telegram sendMessage failed (${response.status}): ${body}`,
      );
    }
  }

  private async sendEventsToChat(
    chatId: string,
    events: ProcessedEvent[],
  ): Promise<void> {
    const capped = events.slice(0, this.maxAlerts);
    const dropped = events.length - capped.length;

    for (let i = 0; i < capped.length; i++) {
      const message = this.formatEvent(capped[i]!);
      await this.sendMessageTo(chatId, message);
      if (i < capped.length - 1) {
        await delay(RATE_LIMIT_DELAY_MS);
      }
    }

    if (dropped > 0) {
      await delay(RATE_LIMIT_DELAY_MS);
      await this.sendMessageTo(
        chatId,
        `<b>${dropped} additional error(s)</b> not shown (max ${this.maxAlerts} per request).`,
      );
    }
  }

  private deduplicateEvents(events: ErrorEvent[]): ErrorEvent[] {
    const seen = new Set<string>();
    const unique: ErrorEvent[] = [];

    for (const event of events) {
      const key = `${event.projectRef}:${event.source}:${event.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(event);
      }
    }

    return unique;
  }

  private formatEvent(event: ProcessedEvent): string {
    const lines: string[] = [];

    // Header with project name
    lines.push(`<b>Error in ${escapeHtml(event.project)}</b>`);
    lines.push("");

    // Source
    lines.push(`<b>Source:</b> ${escapeHtml(event.source)}`);

    // Status code (if present)
    if (event.statusCode !== undefined) {
      lines.push(`<b>Status:</b> ${event.statusCode}`);
    }

    // Timestamp
    lines.push(`<b>Time:</b> ${escapeHtml(event.timestamp)}`);

    // Severity (if set by processor)
    if (event.severity) {
      lines.push(`<b>Severity:</b> ${escapeHtml(event.severity)}`);
    }

    // Source-specific metadata context
    if (event.metadata && Object.keys(event.metadata).length > 0) {
      const renderer =
        SOURCE_METADATA_RENDERERS[event.source] ?? FALLBACK_METADATA_RENDERER;
      const metadataLines = renderer(event.metadata);
      if (metadataLines.length > 0) {
        lines.push("");
        lines.push(...metadataLines);
      }
    }

    // Error message — this can be long, so it goes last
    lines.push("");
    lines.push(`<pre>${escapeHtml(event.message)}</pre>`);

    let text = lines.join("\n");

    // Truncate if exceeding Telegram limit
    if (text.length > MAX_MESSAGE_LENGTH) {
      const suffix = "\n\n... (truncated)";
      text = text.substring(0, MAX_MESSAGE_LENGTH - suffix.length) + suffix;
    }

    return text;
  }

  private async sendMessage(text: string): Promise<void> {
    await this.sendMessageTo(this.chatId, text);
  }
}
