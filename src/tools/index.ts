import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runHelper, HelperError } from "../helper.js";
import {
  createEventShape,
  updateEventShape,
  listEventsShape,
  searchEventsShape,
  idShape,
  deleteEventShape,
  findFreeSlotsShape,
  checkConflictsShape,
} from "../schemas.js";
import {
  formatEvent,
  formatEventList,
  formatCalendars,
  formatFreeSlots,
  formatConflicts,
  type CalendarEvent,
  type CalendarInfo,
} from "../format.js";
import { computeFreeSlots, findOverlapping } from "../availability.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(e: unknown) {
  const msg = e instanceof HelperError ? `[${e.code}] ${e.message}` : String(e);
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

async function conflictWarning(
  call: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  event: CalendarEvent
): Promise<string> {
  if (event.allDay || !event.start || !event.end) return "";
  const targetStart = Date.parse(event.start);
  const targetEnd = Date.parse(event.end);
  if (Number.isNaN(targetStart) || Number.isNaN(targetEnd)) return "";
  try {
    const events = (await call("list-events", {
      start: event.start,
      end: event.end,
    })) as CalendarEvent[];
    const conflicts = findOverlapping(events, targetStart, targetEnd, event.id);
    if (conflicts.length === 0) return "";
    return `\n\n⚠️ Conflicts:\n${formatConflicts(conflicts)}`;
  } catch {
    return "";
  }
}

export function registerTools(server: McpServer, binPath: string): void {
  const call = (command: string, args?: Record<string, unknown>) =>
    runHelper(binPath, command, args);

  server.registerTool(
    "request_access",
    {
      description:
        "Request or check macOS Calendar access permission. Call this first if other tools return ACCESS_DENIED.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = (await call("request-access")) as { granted: boolean };
        return textResult(
          data.granted
            ? "Calendar access granted."
            : "Calendar access denied. Grant it in System Settings → Privacy & Security → Calendars."
        );
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "list_calendars",
    {
      description:
        "List all available calendars with their ids, writability and default flag.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = (await call("list-calendars")) as CalendarInfo[];
        return textResult(formatCalendars(data));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "list_events",
    {
      description:
        "List events between start and end (ISO 8601). Optionally filter by calendarIds.",
      inputSchema: listEventsShape,
    },
    async (args) => {
      try {
        const data = (await call("list-events", args)) as CalendarEvent[];
        return textResult(formatEventList(data));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "search_events",
    {
      description:
        "Search events by text in title/notes/location. Optional start/end period (defaults to ±1 year).",
      inputSchema: searchEventsShape,
    },
    async (args) => {
      try {
        const data = (await call("search-events", args)) as CalendarEvent[];
        return textResult(formatEventList(data));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "get_event",
    {
      description: "Get full details of a single event by id.",
      inputSchema: idShape,
    },
    async (args) => {
      try {
        const data = (await call("get-event", args)) as CalendarEvent;
        return textResult(formatEvent(data));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "create_event",
    {
      description:
        "Create a calendar event. Dates in ISO 8601. Supports alarms and recurrence. Uses default calendar unless calendarId is given.",
      inputSchema: createEventShape,
    },
    async (args) => {
      try {
        const data = (await call("create-event", args)) as CalendarEvent;
        const warning = await conflictWarning(call, data);
        return textResult(`Created:\n${formatEvent(data)}${warning}`);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "update_event",
    {
      description:
        "Update fields of an event by id. For recurring events set span: this | future | all (default this).",
      inputSchema: updateEventShape,
    },
    async (args) => {
      try {
        const data = (await call("update-event", args)) as CalendarEvent;
        const warning = await conflictWarning(call, data);
        return textResult(`Updated:\n${formatEvent(data)}${warning}`);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "delete_event",
    {
      description:
        "Delete an event by id. For recurring events set span: this | future | all (default this).",
      inputSchema: deleteEventShape,
    },
    async (args) => {
      try {
        await call("delete-event", args);
        return textResult(`Deleted event ${args.id}.`);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "find_free_slots",
    {
      description:
        "Find free time slots of at least durationMinutes within [start, end] (ISO 8601). All-day events are ignored. Searches the full 24h day.",
      inputSchema: findFreeSlotsShape,
    },
    async (args) => {
      try {
        const rangeStart = Date.parse(args.start as string);
        const rangeEnd = Date.parse(args.end as string);
        if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd)) {
          return errorResult(
            new HelperError("BAD_INPUT", "Invalid start or end date")
          );
        }
        const events = (await call("list-events", {
          start: args.start,
          end: args.end,
          calendarIds: args.calendarIds,
        })) as CalendarEvent[];
        const slots = computeFreeSlots(
          events,
          rangeStart,
          rangeEnd,
          (args.durationMinutes as number) * 60000
        );
        return textResult(formatFreeSlots(slots));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    "check_conflicts",
    {
      description:
        "List timed events overlapping [start, end] (ISO 8601). All-day events are ignored. Optionally exclude an event by id.",
      inputSchema: checkConflictsShape,
    },
    async (args) => {
      try {
        const targetStart = Date.parse(args.start as string);
        const targetEnd = Date.parse(args.end as string);
        if (Number.isNaN(targetStart) || Number.isNaN(targetEnd)) {
          return errorResult(
            new HelperError("BAD_INPUT", "Invalid start or end date")
          );
        }
        const events = (await call("list-events", {
          start: args.start,
          end: args.end,
          calendarIds: args.calendarIds,
        })) as CalendarEvent[];
        const conflicts = findOverlapping(
          events,
          targetStart,
          targetEnd,
          args.excludeEventId as string | undefined
        );
        return textResult(formatConflicts(conflicts));
      } catch (e) {
        return errorResult(e);
      }
    }
  );
}
