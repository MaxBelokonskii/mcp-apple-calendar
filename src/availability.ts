import type { CalendarEvent } from "./format.js";

export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms
}

export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Timed (non-all-day) events with valid start/end → intervals in ms. */
export function eventsToBusy(events: CalendarEvent[]): Interval[] {
  const out: Interval[] = [];
  for (const e of events) {
    if (e.allDay) continue;
    if (!e.start || !e.end) continue;
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (end <= start) continue;
    out.push({ start, end });
  }
  return out;
}

/** Sort by start, merge overlapping or touching intervals. */
export function mergeBusy(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/** Free gaps >= durationMs within [rangeStart, rangeEnd], complement of busy. */
export function computeFreeSlots(
  events: CalendarEvent[],
  rangeStart: number,
  rangeEnd: number,
  durationMs: number
): Interval[] {
  const busy = mergeBusy(
    eventsToBusy(events)
      // clamp to range and drop intervals fully outside it
      .map((b) => ({
        start: Math.max(b.start, rangeStart),
        end: Math.min(b.end, rangeEnd),
      }))
      .filter((b) => b.end > b.start)
  );

  const free: Interval[] = [];
  let cursor = rangeStart;
  for (const b of busy) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < rangeEnd) free.push({ start: cursor, end: rangeEnd });

  return free.filter((slot) => slot.end - slot.start >= durationMs);
}

/** Timed events intersecting [targetStart, targetEnd), excluding excludeId. */
export function findOverlapping(
  events: CalendarEvent[],
  targetStart: number,
  targetEnd: number,
  excludeId?: string
): CalendarEvent[] {
  return events.filter((e) => {
    if (excludeId && e.id === excludeId) return false;
    if (e.allDay) return false;
    if (!e.start || !e.end) return false;
    const s = Date.parse(e.start);
    const en = Date.parse(e.end);
    if (Number.isNaN(s) || Number.isNaN(en)) return false;
    return overlaps(s, en, targetStart, targetEnd);
  });
}
