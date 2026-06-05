import { describe, it, expect } from "vitest";
import { formatEvent, formatEventList, formatCalendars } from "../src/format.js";

const ev = {
  id: "E1",
  title: "Standup",
  calendarId: "c1",
  calendarTitle: "Work",
  start: "2026-06-10T15:00:00+03:00",
  end: "2026-06-10T15:15:00+03:00",
  allDay: false,
  location: null,
  notes: null,
  url: null,
  isRecurring: true,
  alarms: [],
};

describe("format", () => {
  it("formats a single event with id and title", () => {
    const s = formatEvent(ev);
    expect(s).toContain("Standup");
    expect(s).toContain("E1");
    expect(s).toContain("Work");
  });

  it("formats an empty list", () => {
    expect(formatEventList([])).toContain("No events");
  });

  it("formats a non-empty list with count", () => {
    const s = formatEventList([ev, { ...ev, id: "E2", title: "Lunch" }]);
    expect(s).toContain("2");
    expect(s).toContain("Standup");
    expect(s).toContain("Lunch");
  });

  it("formats calendars marking the default", () => {
    const s = formatCalendars([
      { id: "c1", title: "Home", writable: true, isDefault: true },
    ]);
    expect(s).toContain("Home");
    expect(s).toContain("default");
  });
});
