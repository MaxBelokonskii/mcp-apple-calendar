[**English**](README.md) | [Русский](README.ru.md)

# MCP Apple Calendar

MCP server for working with Apple Calendar (macOS) from Claude, Claude Code and
any MCP client. CRUD for events, multiple calendars, alarms, recurring events,
free-slot search and conflict detection.

Implementation: a TypeScript MCP server (stdio) plus a compiled Swift helper
built on EventKit.

## Requirements

- macOS 14+
- Node.js 18+
- Swift toolchain (Xcode Command Line Tools: `xcode-select --install`)

## Build

```bash
npm install
npm run build   # compiles the Swift helper + TypeScript
```

On first calendar access macOS shows a permission dialog. If you miss it, grant
access manually: System Settings → Privacy & Security → Calendars.

Check access from the terminal:

```bash
echo '{"command":"request-access"}' | ./bin/calendar-helper
```

## Connecting clients

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-calendar": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/mcp-apple-calendar/dist/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add apple-calendar -- node /ABSOLUTE/PATH/mcp-apple-calendar/dist/index.js
```

> By default the helper is looked up at `../bin/calendar-helper` relative to
> `dist/index.js`. Override with the `CALENDAR_HELPER_PATH` environment variable.

## Tools

| Tool | Purpose |
|---|---|
| `request_access` | Request/check Calendar access permission |
| `list_calendars` | List calendars (id, writable, default) |
| `list_events` | Events in a period (`start`, `end` ISO 8601, optional `calendarIds`) |
| `search_events` | Text search (`query`, optional period and `calendarIds`) |
| `get_event` | Event details by `id` |
| `create_event` | Create an event |
| `update_event` | Update an event by `id` |
| `delete_event` | Delete an event by `id` |
| `find_free_slots` | Find free windows ≥ duration in a range (`start`, `end`, `durationMinutes`, optional `calendarIds`) |
| `check_conflicts` | Find events overlapping an interval (`start`, `end`, optional `calendarIds`, `excludeEventId`) |

> `create_event` and `update_event` automatically check for overlaps after
> saving and append a `⚠️ Conflicts:` block to the response (the event is still
> created). All-day events do not count as busy time.

### Data format

- **Dates** — ISO 8601 with offset: `2026-06-10T15:00:00+03:00`. For `allDay`,
  a date `2026-06-10` is enough.
- **Alarms** (`alarms`) — array: relative `{"minutesBefore": 15}` or absolute
  `{"at": "2026-06-10T14:45:00+03:00"}`.
- **Recurrence** (`recurrence`):
  ```json
  {
    "frequency": "daily | weekly | monthly | yearly",
    "interval": 1,
    "daysOfWeek": ["mo", "we", "fr"],
    "end": { "until": "2026-12-31T00:00:00+03:00" }
  }
  ```
  Instead of `until` you may use `{ "count": 10 }`.
- **span** — for recurring events `update_event`/`delete_event` accept `span`:
  `this` (default) | `future` | `all`.

## Development

```bash
npm test            # unit + integration tests (vitest)
npm run dev         # run the server via tsx without building
```

## Architecture

```
AI client ──stdio (JSON-RPC)──► MCP server (TS) ──spawn + JSON──► Swift helper (EventKit)
```

- `src/` — MCP server: `helper.ts` (helper invocation), `schemas.ts` (zod),
  `format.ts` (formatting), `availability.ts` (free slots & conflicts),
  `tools/` (tools), `index.ts` (entry point).
- `swift/Sources/CalendarHelper/main.swift` — EventKit CLI: takes one JSON
  command via stdin, returns `{ok, data}` / `{ok:false, error, code}`.
