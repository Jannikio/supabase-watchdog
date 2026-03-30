import { loadConfig } from "./src/config.ts";
import { log } from "./src/logger.ts";
import { WatchdogState } from "./src/state.ts";
import { startServer } from "./src/server.ts";
import { runPollCycle, intervalToCron } from "./src/pipeline.ts";
import { SupabaseSource } from "./src/sources/mod.ts";
import { PassthroughProcessor } from "./src/processors/mod.ts";
import { TelegramChannel } from "./src/channels/mod.ts";

// ── Config ───────────────────────────────────────────────────────────

const result = await loadConfig();

if (!result.configured) {
  // SETUP MODE: serve setup page, wait for env vars
  log.info("setup_mode", { missing: result.missing });

  startServer({
    mode: "setup",
    missing: result.missing,
  });

  // Nothing else to start — user needs to add env vars
} else {
  // MONITORING MODE: full pipeline + dashboard
  const config = result.config;

  log.info("monitoring_mode", {
    projects: config.projects.length,
    interval: config.polling.interval,
    telegram_mode: config.telegram_mode,
  });

  // Warn if polling mode on Deno Deploy (doesn't work due to overlapping isolates)
  const isDenoDeply = !!Deno.env.get("DENO_DEPLOYMENT_ID");
  if (isDenoDeply && config.telegram_mode === "polling") {
    log.warn("polling_on_deploy", {
      error: "Polling mode is not supported on Deno Deploy. Telegram bot commands will not work reliably. Set WATCHDOG_TELEGRAM_MODE=webhook and WATCHDOG_BASE_URL to your deploy URL.",
    });
  }

  // Token validation
  try {
    const resp = await fetch("https://api.supabase.com/v1/projects", {
      headers: { Authorization: `Bearer ${config.supabase.access_token}` },
    });
    if (!resp.ok) {
      log.warn("token_validation_failed", { status: resp.status });
    } else {
      log.info("token_validated");
    }
    await resp.text();
  } catch (err) {
    log.warn("token_validation_error", { error: String(err) });
  }

  // Initialize state (KV)
  const state = new WatchdogState();
  await state.init();

  // Initialize plugins
  const source = new SupabaseSource(config);
  const processor = new PassthroughProcessor();
  const channel = new TelegramChannel(config);

  // Restore lastPollTime from KV (survives restarts)
  let lastPollTime = new Date();
  const storedPoll = await state.getLastPollTime();
  if (storedPoll) {
    lastPollTime = new Date(storedPoll.timestamp);
    log.info("restored_last_poll_time", { timestamp: storedPoll.timestamp });
  }

  // Set up Telegram (webhook or polling)
  const botDeps = {
    source,
    processor,
    getLastPollTime: () => lastPollTime,
    config,
  };

  if (config.telegram_mode === "webhook" && config.base_url) {
    await channel.setupWebhook(botDeps, config.base_url);
  } else {
    await channel.deleteWebhook();
    channel.startPolling(botDeps);
  }

  // ── Poll lock: prevents cron and initial poll from overlapping ──
  let pollInFlight: Promise<void> | null = null;

  function triggerPoll(): Promise<void> {
    if (pollInFlight) {
      log.info("poll_skipped", { reason: "previous poll still running" });
      return pollInFlight;
    }
    const p = (async () => {
      const r = await runPollCycle(source, processor, channel, state, lastPollTime, config);
      lastPollTime = r.newLastPollTime;
    })();
    pollInFlight = p.finally(() => {
      pollInFlight = null;
    });
    return pollInFlight;
  }

  // Register cron BEFORE starting HTTP server (Deno Deploy requirement)
  const cronExpression = intervalToCron(config.polling.interval);
  Deno.cron("watchdog-poll", cronExpression, () => triggerPoll());
  log.info("cron_scheduled", { expression: cronExpression });

  // Start HTTP server (Deno.serve)
  startServer({
    mode: "monitoring",
    state,
    config,
    onTelegramWebhook: config.telegram_mode === "webhook"
      ? async (update, secretHeader) => {
          const telegramUpdate = update as { update_id: number; message?: { message_id: number; chat: { id: number }; text?: string } };
          return await channel.handleWebhookUpdate(telegramUpdate, secretHeader, state);
        }
      : undefined,
  });

  // Initial poll (uses same lock as cron — no overlap possible)
  await triggerPoll();
}
