import { describe, it, expect } from "vitest";
import {
  overlaps,
  eventsToBusy,
  mergeBusy,
  computeFreeSlots,
  findOverlapping,
} from "../src/availability.js";
import type { CalendarEvent } from "../src/format.js";

function ev(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "x",
    title: "t",
    calendarId: "c",
    calendarTitle: "C",
    start: null,
    end: null,
    allDay: false,
    location: null,
    notes: null,
    url: null,
    isRecurring: false,
    alarms: [],
    ...partial,
  };
}

const MS = (iso: string) => Date.parse(iso);

describe("overlaps", () => {
  it("true when intervals intersect", () => {
    expect(overlaps(0, 10, 5, 15)).toBe(true);
  });
  it("false when only touching at a boundary", () => {
    expect(overlaps(0, 10, 10, 20)).toBe(false);
  });
  it("false when disjoint", () => {
    expect(overlaps(0, 10, 20, 30)).toBe(false);
  });
});

describe("eventsToBusy", () => {
  it("drops all-day events and events without start/end", () => {
    const events = [
      ev({ start: "2026-06-10T10:00:00Z", end: "2026-06-10T11:00:00Z" }),
      ev({ allDay: true, start: "2026-06-10T00:00:00Z", end: "2026-06-11T00:00:00Z" }),
      ev({ start: null, end: null }),
    ];
    const busy = eventsToBusy(events);
    expect(busy).toEqual([
      { start: MS("2026-06-10T10:00:00Z"), end: MS("2026-06-10T11:00:00Z") },
    ]);
  });
});

describe("mergeBusy", () => {
  it("returns empty for empty input", () => {
    expect(mergeBusy([])).toEqual([]);
  });
  it("merges overlapping and touching intervals, sorts unsorted input", () => {
    const merged = mergeBusy([
      { start: 50, end: 60 },
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 15, end: 18 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 20 },
      { start: 50, end: 60 },
    ]);
  });
});

describe("computeFreeSlots", () => {
  const range = (s: string, e: string) => [MS(s), MS(e)] as const;

  it("returns the whole range when there are no events", () => {
    const [s, e] = range("2026-06-10T09:00:00Z", "2026-06-10T12:00:00Z");
    expect(computeFreeSlots([], s, e, 30 * 60000)).toEqual([{ start: s, end: e }]);
  });

  it("splits the range around a middle event", () => {
    const [s, e] = range("2026-06-10T09:00:00Z", "2026-06-10T12:00:00Z");
    const events = [ev({ start: "2026-06-10T10:00:00Z", end: "2026-06-10T11:00:00Z" })];
    expect(computeFreeSlots(events, s, e, 30 * 60000)).toEqual([
      { start: MS("2026-06-10T09:00:00Z"), end: MS("2026-06-10T10:00:00Z") },
      { start: MS("2026-06-10T11:00:00Z"), end: MS("2026-06-10T12:00:00Z") },
    ]);
  });

  it("drops gaps shorter than the requested duration", () => {
    const [s, e] = range("2026-06-10T09:00:00Z", "2026-06-10T12:00:00Z");
    const events = [
      ev({ start: "2026-06-10T09:20:00Z", end: "2026-06-10T11:00:00Z" }),
    ];
    // first gap 09:00-09:20 = 20min < 30min dropped; second 11:00-12:00 kept
    expect(computeFreeSlots(events, s, e, 30 * 60000)).toEqual([
      { start: MS("2026-06-10T11:00:00Z"), end: MS("2026-06-10T12:00:00Z") },
    ]);
  });

  it("clamps events that extend beyond the range and ignores all-day", () => {
    const [s, e] = range("2026-06-10T09:00:00Z", "2026-06-10T12:00:00Z");
    const events = [
      ev({ start: "2026-06-10T08:00:00Z", end: "2026-06-10T10:00:00Z" }),
      ev({ allDay: true, start: "2026-06-10T00:00:00Z", end: "2026-06-11T00:00:00Z" }),
    ];
    expect(computeFreeSlots(events, s, e, 30 * 60000)).toEqual([
      { start: MS("2026-06-10T10:00:00Z"), end: MS("2026-06-10T12:00:00Z") },
    ]);
  });
});

describe("findOverlapping", () => {
  const ts = MS("2026-06-10T10:00:00Z");
  const te = MS("2026-06-10T11:00:00Z");

  it("returns events that intersect the target interval", () => {
    const events = [
      ev({ id: "a", start: "2026-06-10T10:30:00Z", end: "2026-06-10T11:30:00Z" }),
      ev({ id: "b", start: "2026-06-10T12:00:00Z", end: "2026-06-10T13:00:00Z" }),
    ];
    expect(findOverlapping(events, ts, te).map((e) => e.id)).toEqual(["a"]);
  });

  it("excludes the event with excludeId and ignores all-day", () => {
    const events = [
      ev({ id: "self", start: "2026-06-10T10:00:00Z", end: "2026-06-10T11:00:00Z" }),
      ev({ id: "allday", allDay: true, start: "2026-06-10T00:00:00Z", end: "2026-06-11T00:00:00Z" }),
    ];
    expect(findOverlapping(events, ts, te, "self")).toEqual([]);
  });

  it("does not count boundary-touching events as conflicts", () => {
    const events = [
      ev({ id: "before", start: "2026-06-10T09:00:00Z", end: "2026-06-10T10:00:00Z" }),
    ];
    expect(findOverlapping(events, ts, te)).toEqual([]);
  });
});
