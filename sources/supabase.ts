import type { ErrorEvent, Source, WatchdogConfig } from "../types.ts";

const API_BASE = "https://api.supabase.com/v1";
const MAX_QUERY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ApiResponse {
  result: LogRow[] | null;
  error: unknown;
}

interface LogRow {
  timestamp: number; // Unix microseconds
  event_message?: string;
  [key: string]: unknown;
}

const ERROR_QUERIES: Record<string, string> = {
  edge_logs: `
    select
      t.timestamp,
      t.event_message,
      r.status_code as status_code,
      req.method as method,
      req.path as path
    from edge_logs t
    cross join unnest(t.metadata) as m
    cross join unnest(m.response) as r
    cross join unnest(m.request) as req
    where r.status_code >= {{MIN_STATUS}}
    order by t.timestamp desc
    limit 200
  `,

  auth_logs: `
    select
      t.timestamp,
      t.event_message,
      m.status as status_code,
      m.path as path,
      m.msg as msg,
      m.level as level
    from auth_logs t
    cross join unnest(t.metadata) as m
    where m.level in ('error', 'fatal', 'panic')
       or safe_cast(m.status as int64) >= {{MIN_STATUS}}
    order by t.timestamp desc
    limit 200
  `,

  postgres_logs: `
    select
      t.timestamp,
      t.event_message,
      p.error_severity as error_severity,
      p.sql_state_code as sql_state_code,
      p.query as query,
      p.user_name as user_name,
      p.application_name as application_name,
      p.detail as detail,
      p.hint as hint
    from postgres_logs t
    cross join unnest(t.metadata) as m
    cross join unnest(m.parsed) as p
    where regexp_contains(p.error_severity, 'ERROR|FATAL|PANIC')
    order by t.timestamp desc
    limit 200
  `,

  storage_logs: `
    select
      t.timestamp,
      t.event_message,
      r.statusCode as status_code,
      m.level as level
    from storage_logs t
    cross join unnest(t.metadata) as m
    cross join unnest(m.res) as r
    where r.statusCode >= {{MIN_STATUS}}
       or m.level in ('error', 'fatal')
    order by t.timestamp desc
    limit 200
  `,

  realtime_logs: `
    select
      t.timestamp,
      t.event_message,
      m.level as level
    from realtime_logs t
    cross join unnest(t.metadata) as m
    where m.level in ('error', 'fatal')
    order by t.timestamp desc
    limit 200
  `,

  postgrest_logs: `
    select
      t.timestamp,
      t.event_message
    from postgrest_logs t
    where regexp_contains(t.event_message, '(?i)error|fatal|panic')
    order by t.timestamp desc
    limit 200
  `,

  supavisor_logs: `
    select
      t.timestamp,
      t.event_message,
      m.level as level
    from supavisor_logs t
    cross join unnest(t.metadata) as m
    where m.level in ('error', 'fatal')
    order by t.timestamp desc
    limit 200
  `,
};

export class SupabaseSource implements Source {
  readonly name = "supabase";

  private accessToken: string;
  private projects: WatchdogConfig["projects"];
  private sources: string[];
  private minStatusCode: number;
  private ignorePatterns: string[];

  constructor(config: WatchdogConfig) {
    this.accessToken = config.supabase.access_token;
    this.projects = config.projects;
    this.sources = config.polling.sources;
    this.minStatusCode = config.filters.min_status_code;
    this.ignorePatterns = config.filters.ignore_patterns;
  }

  async poll(since: Date): Promise<ErrorEvent[]> {
    const now = new Date();

    // Clamp to 24h max window
    const earliest = new Date(now.getTime() - MAX_QUERY_WINDOW_MS);
    const effectiveSince = since < earliest ? earliest : since;

    const allEvents: ErrorEvent[] = [];

    for (const project of this.projects) {
      for (const logSource of this.sources) {
        try {
          const events = await this.queryLogSource(
            project.ref,
            project.name,
            logSource,
            effectiveSince,
            now,
          );
          allEvents.push(...events);
        } catch (error) {
          console.warn(
            `[watchdog] Failed to query ${logSource} for ${project.name}: ${error}`,
          );
        }
      }
    }

    return this.applyIgnorePatterns(allEvents);
  }

  private buildQuery(logSource: string): string {
    const template = ERROR_QUERIES[logSource];
    if (!template) {
      return `select timestamp, event_message from ${logSource} order by timestamp desc limit 100`;
    }
    return template.replaceAll("{{MIN_STATUS}}", String(this.minStatusCode));
  }

  private async queryApi(
    ref: string,
    sql: string,
    since: Date,
    until: Date,
  ): Promise<LogRow[]> {
    const url = new URL(
      `${API_BASE}/projects/${ref}/analytics/endpoints/logs.all`,
    );
    url.searchParams.set("sql", sql);
    url.searchParams.set("iso_timestamp_start", since.toISOString());
    url.searchParams.set("iso_timestamp_end", until.toISOString());

    const response = await fetch(url.toString(), {
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Management API returned ${response.status}: ${await response.text()}`,
      );
    }

    const body = (await response.json()) as ApiResponse;

    if (body.error) {
      throw new Error(
        `Management API query error: ${JSON.stringify(body.error)}`,
      );
    }

    return body.result ?? [];
  }

  private async queryLogSource(
    ref: string,
    projectName: string,
    logSource: string,
    since: Date,
    until: Date,
  ): Promise<ErrorEvent[]> {
    const sql = this.buildQuery(logSource);
    const rows = await this.queryApi(ref, sql, since, until);

    return rows.map((row) => this.rowToEvent(row, ref, projectName, logSource));
  }

  private rowToEvent(
    row: LogRow,
    ref: string,
    projectName: string,
    logSource: string,
  ): ErrorEvent {
    // Timestamp: API returns unix microseconds
    const ts =
      typeof row.timestamp === "number"
        ? new Date(row.timestamp / 1000)
        : new Date();

    // Status code: varies by source
    const statusCode =
      typeof row.status_code === "number" ? row.status_code : undefined;

    // Message: prefer event_message, fall back to other fields
    const message =
      row.event_message ?? row.msg ?? row.error ?? row.query ?? "Unknown error";

    // Collect remaining fields as metadata
    const {
      timestamp: _ts,
      event_message: _em,
      status_code: _sc,
      ...rest
    } = row;

    return {
      project: projectName,
      projectRef: ref,
      source: logSource,
      timestamp: ts.toISOString(),
      statusCode,
      message: String(message),
      metadata: Object.keys(rest).length > 0 ? rest : undefined,
    };
  }

  private applyIgnorePatterns(events: ErrorEvent[]): ErrorEvent[] {
    if (this.ignorePatterns.length === 0) return events;

    const lowered = this.ignorePatterns.map((p) => p.toLowerCase());
    return events.filter((event) => {
      const msg = event.message.toLowerCase();
      return !lowered.some((pattern) => msg.includes(pattern));
    });
  }
}
