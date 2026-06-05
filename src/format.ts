import type { Interval } from "./availability.js";

export interface CalendarEvent {
  id: string;
  title: string;
  calendarId: string;
  calendarTitle: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  url: string | null;
  isRecurring: boolean;
  alarms: Array<{ minutesBefore: number } | { at: string }>;
}

export interface CalendarInfo {
  id: string;
  title: string;
  writable: boolean;
  isDefault: boolean;
}

export function formatEvent(e: CalendarEvent): string {
  const lines = [
    `• ${e.title}${e.isRecurring ? " (recurring)" : ""}`,
    `  id: ${e.id}`,
    `  calendar: ${e.calendarTitle}`,
    `  when: ${e.allDay ? `${e.start} (all day)` : `${e.start} → ${e.end}`}`,
  ];
  if (e.location) lines.push(`  location: ${e.location}`);
  if (e.url) lines.push(`  url: ${e.url}`);
  if (e.alarms.length) lines.push(`  alarms: ${JSON.stringify(e.alarms)}`);
  if (e.notes) lines.push(`  notes: ${e.notes}`);
  return lines.join("\n");
}

export function formatEventList(events: CalendarEvent[]): string {
  if (events.length === 0) return "No events found.";
  return `${events.length} event(s):\n\n${events.map(formatEvent).join("\n\n")}`;
}

export function formatCalendars(cals: CalendarInfo[]): string {
  if (cals.length === 0) return "No calendars found.";
  return cals
    .map(
      (c) =>
        `• ${c.title} (id: ${c.id})${c.isDefault ? " [default]" : ""}${
          c.writable ? "" : " [read-only]"
        }`
    )
    .join("\n");
}

function isoLocal(ms: number): string {
  // ISO в UTC; клиент сам интерпретирует. Достаточно для отображения.
  return new Date(ms).toISOString();
}

export function formatFreeSlots(slots: Interval[]): string {
  if (slots.length === 0) return "No free slots found in the given range.";
  const lines = slots.map(
    (s) =>
      `• ${isoLocal(s.start)} → ${isoLocal(s.end)} (${Math.round(
        (s.end - s.start) / 60000
      )} min)`
  );
  return `${slots.length} free slot(s):\n${lines.join("\n")}`;
}

export function formatConflicts(events: CalendarEvent[]): string {
  if (events.length === 0) return "No conflicts.";
  const lines = events.map(
    (e) => `• ${e.title} (${e.start} → ${e.end}) [${e.calendarTitle}] id: ${e.id}`
  );
  return `${events.length} conflict(s):\n${lines.join("\n")}`;
}
