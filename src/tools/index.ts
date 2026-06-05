import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runHelper, HelperError } from "../helper.js";
import {
  createEventShape,
  updateEventShape,
  listEventsShape,
  searchEventsShape,
  idShape,
  deleteEventShape,
} from "../schemas.js";
import {
  formatEvent,
  formatEventList,
  formatCalendars,
  type CalendarEvent,
  type CalendarInfo,
} from "../format.js";

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
        return textResult(`Created:\n${formatEvent(data)}`);
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
        return textResult(`Updated:\n${formatEvent(data)}`);
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
}
