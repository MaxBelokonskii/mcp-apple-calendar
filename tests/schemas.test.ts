import { describe, it, expect } from "vitest";
import { createEventShape, recurrenceSchema, alarmSchema } from "../src/schemas.js";
import { z } from "zod";

const createEvent = z.object(createEventShape);

describe("schemas", () => {
  it("accepts a minimal valid event", () => {
    const r = createEvent.safeParse({
      title: "X",
      startDate: "2026-06-10T15:00:00+03:00",
      endDate: "2026-06-10T16:00:00+03:00",
    });
    expect(r.success).toBe(true);
  });

  it("rejects event without title", () => {
    const r = createEvent.safeParse({
      startDate: "2026-06-10T15:00:00+03:00",
      endDate: "2026-06-10T16:00:00+03:00",
    });
    expect(r.success).toBe(false);
  });

  it("accepts relative and absolute alarms", () => {
    expect(alarmSchema.safeParse({ minutesBefore: 15 }).success).toBe(true);
    expect(alarmSchema.safeParse({ at: "2026-06-10T14:45:00+03:00" }).success).toBe(true);
    expect(alarmSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a weekly recurrence with end count", () => {
    const r = recurrenceSchema.safeParse({
      frequency: "weekly",
      interval: 2,
      daysOfWeek: ["mo", "we"],
      end: { count: 10 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown frequency", () => {
    expect(recurrenceSchema.safeParse({ frequency: "hourly" }).success).toBe(false);
  });
});
