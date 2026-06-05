# Availability & Conflicts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить инструменты `find_free_slots` и `check_conflicts` (с авто-предупреждением о конфликтах в create/update) и двуязычный README.

**Architecture:** Чистый TypeScript-модуль `availability.ts` вычисляет свободные слоты и пересечения над событиями, полученными существующей командой хелпера `list-events`. Swift не меняется. All-day события не считаются занятостью.

**Tech Stack:** TypeScript, zod, vitest. Без изменений Swift/EventKit.

---

## Соглашения

- Все интервалы внутри `availability.ts` — в epoch-миллисекундах: `interface Interval { start: number; end: number }`.
- `CalendarEvent` уже определён в `src/format.ts` (поля `start`/`end` — ISO-строки или null, `allDay: boolean`, `id: string`).
- Парсинг ISO → ms: `Date.parse(s)`; `NaN` → ошибка `BAD_INPUT`.
- Пересечение полуинтервалов `[start, end)`: `aStart < bEnd && bStart < aEnd` (касание границами НЕ считается пересечением).
- Ветка разработки: `feature/availability-and-conflicts`.

## File Structure

- `src/availability.ts` — **новый**. Чистые функции: `Interval`, `overlaps`, `eventsToBusy`, `mergeBusy`, `computeFreeSlots`, `findOverlapping`.
- `src/schemas.ts` — **изменить**. Добавить `findFreeSlotsShape`, `checkConflictsShape`.
- `src/format.ts` — **изменить**. Добавить `formatFreeSlots`, `formatConflicts`.
- `src/tools/index.ts` — **изменить**. Добавить инструменты `find_free_slots`, `check_conflicts`; вшить предупреждение о конфликтах в `create_event`/`update_event`.
- `tests/availability.test.ts` — **новый**. Unit-тесты чистых функций.
- `README.md` — **заменить** на английский (основной).
- `README.ru.md` — **новый**. Текущий русский контент + шапка-переключатель.

---

## Task 1: Создать ветку

**Files:** —

- [ ] **Step 1: Создать и переключиться на ветку**

```bash
cd /Users/maxbelokonskii/Desktop/workspace/pat/mcp-apple-calendar
git checkout -b feature/availability-and-conflicts
git branch --show-current
```
Expected: `feature/availability-and-conflicts`.

---

## Task 2: Чистые функции availability.ts (TDD)

**Files:**
- Create: `src/availability.ts`
- Test: `tests/availability.test.ts`

- [ ] **Step 1: Написать падающий тест `tests/availability.test.ts`**

```ts
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
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run tests/availability.test.ts`
Expected: FAIL — `src/availability.js` не существует.

- [ ] **Step 3: Реализовать `src/availability.ts`**

```ts
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
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run tests/availability.test.ts`
Expected: PASS (все группы).

- [ ] **Step 5: Commit**

```bash
git add src/availability.ts tests/availability.test.ts
git commit -m "feat: availability pure functions (free slots, conflicts)"
```

---

## Task 3: Схемы и форматирование

**Files:**
- Modify: `src/schemas.ts`
- Modify: `src/format.ts`

- [ ] **Step 1: Добавить схемы в конец `src/schemas.ts`**

```ts
export const findFreeSlotsShape = {
  start: z.string().describe("ISO 8601 начало диапазона поиска"),
  end: z.string().describe("ISO 8601 конец диапазона поиска"),
  durationMinutes: z.number().int().positive().describe("Длительность слота в минутах"),
  calendarIds: z.array(z.string()).optional(),
};

export const checkConflictsShape = {
  start: z.string().describe("ISO 8601 начало интервала"),
  end: z.string().describe("ISO 8601 конец интервала"),
  calendarIds: z.array(z.string()).optional(),
  excludeEventId: z.string().optional().describe("ID события, которое исключить из проверки"),
};
```

- [ ] **Step 2: Добавить форматтеры в конец `src/format.ts`**

Используем существующий тип `Interval` из `availability.ts`. Импорт добавить в начало файла.

В начало `src/format.ts` добавить импорт (после первой строки файла он не нужен — файл начинается с `export interface CalendarEvent`; вставить импорт самой первой строкой):

```ts
import type { Interval } from "./availability.js";
```

В конец `src/format.ts` добавить:

```ts
function isoLocal(ms: number): string {
  // ISO в UTC; клиент сам интерпретирует. Достаточно для отображения.
  return new Date(ms).toISOString();
}

export function formatFreeSlots(slots: Interval[]): string {
  if (slots.length === 0) return "No free slots found in the given range.";
  const lines = slots.map(
    (s) => `• ${isoLocal(s.start)} → ${isoLocal(s.end)} (${Math.round((s.end - s.start) / 60000)} min)`
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
```

> Примечание: импорт `Interval` как `type` не создаёт цикл выполнения (только типовая зависимость), поэтому совместного импорта `format.ts` ↔ `availability.ts` достаточно — `availability.ts` импортирует `CalendarEvent` как тип, `format.ts` импортирует `Interval` как тип.

- [ ] **Step 3: Проверить компиляцию типов**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add src/schemas.ts src/format.ts
git commit -m "feat: schemas and formatters for free slots and conflicts"
```

---

## Task 4: Инструменты find_free_slots и check_conflicts

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Обновить импорты в начале `src/tools/index.ts`**

Заменить блок импортов схем и форматтеров на расширенный.

Импорт схем — заменить:
```ts
import {
  createEventShape,
  updateEventShape,
  listEventsShape,
  searchEventsShape,
  idShape,
  deleteEventShape,
} from "../schemas.js";
```
на:
```ts
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
```

Импорт форматтеров — заменить:
```ts
import {
  formatEvent,
  formatEventList,
  formatCalendars,
  type CalendarEvent,
  type CalendarInfo,
} from "../format.js";
```
на:
```ts
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
```

- [ ] **Step 2: Добавить регистрацию `find_free_slots` и `check_conflicts`**

Внутри `registerTools`, перед закрывающей `}` функции, добавить:

```ts
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
          return errorResult(new HelperError("BAD_INPUT", "Invalid start or end date"));
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
          return errorResult(new HelperError("BAD_INPUT", "Invalid start or end date"));
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
```

- [ ] **Step 3: Smoke-тест новых инструментов через MCP-сервер**

```bash
npm run build:ts
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_free_slots","arguments":{"start":"2026-06-07T09:00:00+03:00","end":"2026-06-07T22:00:00+03:00","durationMinutes":60}}}' | node dist/index.js 2>/dev/null | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{for(const l of s.split('\n')){if(!l.trim())continue;const m=JSON.parse(l);if(m.id===2)console.log(m.result.content[0].text)}})"
```
Expected: текст со свободными слотами; видно, что окно 16:00–18:00 (Репетиция) исключено.

- [ ] **Step 4: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat: find_free_slots and check_conflicts tools"
```

---

## Task 5: Авто-предупреждение о конфликтах в create_event / update_event

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Добавить вспомогательную функцию после `errorResult`**

```ts
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
```

> `conflictWarning` принимает `call` параметром, т.к. `call` объявлен внутри `registerTools`. Передавать будем `call` из замыкания.

- [ ] **Step 2: Обновить обработчик `create_event`**

Заменить тело `async (args) => {...}` инструмента `create_event` на:

```ts
    async (args) => {
      try {
        const data = (await call("create-event", args)) as CalendarEvent;
        const warning = await conflictWarning(call, data);
        return textResult(`Created:\n${formatEvent(data)}${warning}`);
      } catch (e) {
        return errorResult(e);
      }
    }
```

- [ ] **Step 3: Обновить обработчик `update_event`**

Заменить тело инструмента `update_event` на:

```ts
    async (args) => {
      try {
        const data = (await call("update-event", args)) as CalendarEvent;
        const warning = await conflictWarning(call, data);
        return textResult(`Updated:\n${formatEvent(data)}${warning}`);
      } catch (e) {
        return errorResult(e);
      }
    }
```

- [ ] **Step 4: Сборка и проверка существующих тестов**

```bash
npm run build:ts && npx vitest run
```
Expected: компиляция без ошибок, все тесты зелёные.

- [ ] **Step 5: Ручная проверка конфликта (создаём пересекающееся событие, потом удаляем)**

```bash
RESP=$(printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_event","arguments":{"title":"Conflict probe","startDate":"2026-06-07T16:30:00+03:00","endDate":"2026-06-07T17:00:00+03:00","calendarId":"EB0E1A6E-693A-4741-8220-E688A634BC6D"}}}' | node dist/index.js 2>/dev/null)
echo "$RESP" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{for(const l of s.split('\n')){if(!l.trim())continue;const m=JSON.parse(l);if(m.id===2)console.log(m.result.content[0].text)}})"
```
Expected: ответ `Created: ...` + блок `⚠️ Conflicts:` со строкой «Репетиция» (16:00–18:00). После проверки удалить пробное событие через `delete_event` по выведенному id.

- [ ] **Step 6: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat: warn about conflicts on create/update"
```

---

## Task 6: Двуязычный README

**Files:**
- Create: `README.ru.md` (текущий русский контент)
- Modify: `README.md` (заменить на английский)

- [ ] **Step 1: Скопировать текущий README в `README.ru.md` и добавить шапку**

```bash
cp README.md README.ru.md
```
Затем в самое начало `README.ru.md` добавить строку-переключатель (перед `# MCP Apple Calendar`):

```markdown
[English](README.md) | **Русский**

```

В разделе инструментов `README.ru.md` добавить строки в таблицу:

```markdown
| `find_free_slots` | Найти свободные окна ≥ длительности в диапазоне (`start`, `end`, `durationMinutes`, опц. `calendarIds`) |
| `check_conflicts` | Найти события, пересекающие интервал (`start`, `end`, опц. `calendarIds`, `excludeEventId`) |
```

И добавить абзац после таблицы инструментов:

```markdown
> `create_event` и `update_event` после сохранения автоматически проверяют
> пересечения и добавляют блок `⚠️ Conflicts:` в ответ (событие всё равно
> создаётся). События «на весь день» не считаются занятостью.
```

- [ ] **Step 2: Записать английский `README.md`**

```markdown
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
```

- [ ] **Step 3: Проверить, что ссылки-переключатели на месте**

Run: `head -1 README.md && head -1 README.ru.md`
Expected: первая строка `README.md` содержит ссылку на `README.ru.md`; первая строка `README.ru.md` содержит ссылку на `README.md`.

- [ ] **Step 4: Commit**

```bash
git add README.md README.ru.md
git commit -m "docs: bilingual README (English primary + Russian)"
```

---

## Task 7: Финальная проверка и интеграция

**Files:** —

- [ ] **Step 1: Полная сборка и тесты**

```bash
npm run build && npm test
```
Expected: сборка успешна, все тесты зелёные.

- [ ] **Step 2: Проверить список инструментов (должно быть 10)**

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js 2>/dev/null | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{for(const l of s.split('\n')){if(!l.trim())continue;const m=JSON.parse(l);if(m.id===2)console.log(m.result.tools.length, m.result.tools.map(t=>t.name).join(', '))}})"
```
Expected: `10 ` и список с `find_free_slots`, `check_conflicts`.

- [ ] **Step 3: Завершение ветки**

Использовать superpowers:finishing-a-development-branch для слияния/PR.

---

## Self-Review заметки

- **Покрытие спеки:** `find_free_slots` ↔ Task 4; `check_conflicts` ↔ Task 4; авто-конфликты в create/update ↔ Task 5; чистые функции + all-day игнор ↔ Task 2; схемы ↔ Task 3; форматтеры ↔ Task 3; двуязычный README ↔ Task 6; тесты ↔ Task 2 + Task 5/7.
- **Типы:** `Interval` определён в Task 2, используется в Task 3 (`format.ts` импортирует как type). `CalendarEvent` — из `format.ts`, импортируется в `availability.ts` как type (взаимный type-only импорт, без runtime-цикла). `HelperError` уже экспортируется из `helper.ts` и импортируется в `tools/index.ts` (используется в Task 4 для BAD_INPUT) — добавить в импорт, если отсутствует.
- **Сигнатуры:** `computeFreeSlots(events, rangeStart, rangeEnd, durationMs)`, `findOverlapping(events, targetStart, targetEnd, excludeId?)` — одинаковы в Task 2/4/5.
- **Замечание для Task 4:** `HelperError` уже импортируется в `tools/index.ts` (используется в `errorResult`), отдельный импорт не требуется.
```
