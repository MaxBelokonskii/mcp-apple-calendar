import { z } from "zod";

export const alarmSchema = z.union([
  z.object({ minutesBefore: z.number().int().nonnegative() }).strict(),
  z.object({ at: z.string() }).strict(),
]);

export const recurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().positive().optional(),
  daysOfWeek: z
    .array(z.enum(["su", "mo", "tu", "we", "th", "fr", "sa"]))
    .optional(),
  end: z
    .union([
      z.object({ until: z.string() }).strict(),
      z.object({ count: z.number().int().positive() }).strict(),
    ])
    .optional(),
});

const eventFields = {
  title: z.string().min(1),
  startDate: z.string().describe("ISO 8601, напр. 2026-06-10T15:00:00+03:00"),
  endDate: z.string().describe("ISO 8601"),
  allDay: z.boolean().optional(),
  calendarId: z.string().optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  url: z.string().url().optional(),
  alarms: z.array(alarmSchema).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
};

export const createEventShape = eventFields;

export const updateEventShape = {
  id: z.string(),
  title: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  allDay: z.boolean().optional(),
  calendarId: z.string().optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  url: z.string().url().optional(),
  alarms: z.array(alarmSchema).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  span: z.enum(["this", "future", "all"]).optional(),
};

export const listEventsShape = {
  start: z.string().describe("ISO 8601 начало периода"),
  end: z.string().describe("ISO 8601 конец периода"),
  calendarIds: z.array(z.string()).optional(),
};

export const searchEventsShape = {
  query: z.string().min(1),
  start: z.string().optional(),
  end: z.string().optional(),
  calendarIds: z.array(z.string()).optional(),
};

export const idShape = { id: z.string() };

export const deleteEventShape = {
  id: z.string(),
  span: z.enum(["this", "future", "all"]).optional(),
};
