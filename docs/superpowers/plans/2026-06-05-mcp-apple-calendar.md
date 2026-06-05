# MCP Apple Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP-сервер на TypeScript, дающий AI-агентам CRUD-доступ к Apple Calendar через Swift/EventKit-хелпер.

**Architecture:** Node.js MCP-сервер (stdio) валидирует запросы через zod и вызывает скомпилированный Swift CLI-хелпер на EventKit. Хелпер принимает одну JSON-команду через stdin и возвращает `{ok, data}` / `{ok:false, error, code}`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (1.x), `zod`, `vitest`, Swift Package Manager, EventKit (macOS 14+).

---

## Соглашения

- **Контракт хелпера:** вход (stdin) — `{"command": "<name>", "args": {...}}`. Выход (stdout) — ровно один JSON-объект `{"ok": true, "data": ...}` или `{"ok": false, "error": "<msg>", "code": "<CODE>"}`. Хелпер всегда завершается с кодом 0; ошибки передаются в JSON.
- **Коды ошибок:** `ACCESS_DENIED`, `NOT_FOUND`, `BAD_INPUT`, `SAVE_FAILED`, `INTERNAL`.
- **Команды хелпера:** `request-access`, `list-calendars`, `list-events`, `search-events`, `get-event`, `create-event`, `update-event`, `delete-event`.
- **Сериализация события (объект `event`):**
  ```json
  {
    "id": "string", "title": "string", "calendarId": "string", "calendarTitle": "string",
    "start": "ISO8601", "end": "ISO8601", "allDay": false,
    "location": "string|null", "notes": "string|null", "url": "string|null",
    "isRecurring": false,
    "alarms": [{"minutesBefore": 15} | {"at": "ISO8601"}]
  }
  ```
- **span** (для повторяющихся в update/delete): `"this"` → `EKSpan.thisEvent`; `"future"` и `"all"` → `EKSpan.futureEvents`. По умолчанию `"this"`.

## File Structure

- `package.json` — npm-метаданные, скрипты сборки (Swift + TS), зависимости.
- `tsconfig.json` — конфиг TypeScript (NodeNext, strict, outDir `dist`).
- `vitest.config.ts` — конфиг тестов.
- `.gitignore` — `node_modules`, `dist`, `bin`, `swift/.build`.
- `swift/Package.swift` — SwiftPM-манифест исполняемого `CalendarHelper`, macOS 14, embed Info.plist.
- `swift/Info.plist` — `NSCalendarsFullAccessUsageDescription` для TCC-диалога.
- `swift/Sources/CalendarHelper/main.swift` — весь Swift-хелпер (парсинг команды, диспетчер, реализации, сериализация).
- `bin/calendar-helper` — скомпилированный бинарник (продукт сборки, в .gitignore).
- `src/helper.ts` — обёртка: spawn бинарника, JSON in/out, маппинг ошибок в исключения.
- `src/schemas.ts` — zod-схемы аргументов всех инструментов.
- `src/format.ts` — форматирование `event`/списков в человекочитаемый текст для ответа MCP.
- `src/tools/index.ts` — регистрация всех 8 инструментов на сервере.
- `src/index.ts` — точка входа: создаёт McpServer, подключает stdio.
- `tests/helper.test.ts` — unit-тесты helper.ts (fake-бинарник на node).
- `tests/schemas.test.ts` — unit-тесты zod-схем.
- `tests/format.test.ts` — unit-тесты форматирования.
- `tests/integration.test.ts` — интеграционный тест полного цикла (только macOS + доступ).
- `tests/fixtures/fake-helper.mjs` — поддельный хелпер для unit-тестов helper.ts.
- `README.md` — установка, сборка, подключение к клиентам, выдача прав.

---

## Task 1: Скаффолдинг проекта

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1: Инициализировать git и npm**

```bash
cd /Users/maxbelokonskii/Desktop/workspace/pat/mcp-apple-calendar
git init
npm init -y
```

- [ ] **Step 2: Установить зависимости**

```bash
npm install @modelcontextprotocol/sdk@^1 zod@^3
npm install -D typescript@^5 vitest@^2 @types/node@^22 tsx@^4
```

- [ ] **Step 3: Записать `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Записать `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Записать `.gitignore`**

```
node_modules/
dist/
bin/
swift/.build/
*.log
```

- [ ] **Step 6: Настроить `package.json`**

Установить `"type": "module"`, `"bin"` и скрипты. Заменить блоки `main`/`scripts`/добавить `type` и `bin`:

```json
{
  "type": "module",
  "bin": { "mcp-apple-calendar": "dist/index.js" },
  "scripts": {
    "build:swift": "swift build -c release --package-path swift && mkdir -p bin && cp swift/.build/release/CalendarHelper bin/calendar-helper",
    "build:ts": "tsc",
    "build": "npm run build:swift && npm run build:ts",
    "test": "vitest run",
    "dev": "tsx src/index.ts"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold project (npm, ts, vitest)"
```

---

## Task 2: Swift-хелпер — каркас, доступ и список календарей

**Files:**
- Create: `swift/Package.swift`, `swift/Info.plist`, `swift/Sources/CalendarHelper/main.swift`

- [ ] **Step 1: Записать `swift/Package.swift`**

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CalendarHelper",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "CalendarHelper",
            path: "Sources/CalendarHelper",
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Info.plist",
                ])
            ]
        )
    ]
)
```

- [ ] **Step 2: Записать `swift/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSCalendarsFullAccessUsageDescription</key>
  <string>This MCP server reads and writes Calendar events on your behalf.</string>
</dict>
</plist>
```

- [ ] **Step 3: Записать каркас `swift/Sources/CalendarHelper/main.swift`**

Этот файл наполняется в задачах 2–4. Сейчас — инфраструктура + `request-access` + `list-calendars`.

```swift
import Foundation
import EventKit

let store = EKEventStore()

// MARK: - Output helpers

func emit(_ obj: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [])
    FileHandle.standardOutput.write(data)
    exit(0)
}

func ok(_ data: Any) { emit(["ok": true, "data": data]) }
func fail(_ code: String, _ message: String) {
    emit(["ok": false, "code": code, "error": message])
}

// MARK: - Date helpers

let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
let isoNoFrac: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()
let dayFmt: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone.current
    return f
}()

func parseDate(_ s: String?) -> Date? {
    guard let s = s else { return nil }
    if let d = iso.date(from: s) { return d }
    if let d = isoNoFrac.date(from: s) { return d }
    if let d = dayFmt.date(from: s) { return d }
    return nil
}

func isoString(_ d: Date) -> String { isoNoFrac.string(from: d) }

// MARK: - Access

func ensureAccess() -> Bool {
    let status = EKEventStore.authorizationStatus(for: .event)
    if status == .fullAccess { return true }
    let sem = DispatchSemaphore(value: 0)
    var granted = false
    store.requestFullAccessToEvents { ok, _ in granted = ok; sem.signal() }
    sem.wait()
    return granted
}

// MARK: - Serialization

func serialize(_ e: EKEvent) -> [String: Any] {
    var alarms: [[String: Any]] = []
    for a in e.alarms ?? [] {
        if let abs = a.absoluteDate {
            alarms.append(["at": isoString(abs)])
        } else {
            alarms.append(["minutesBefore": Int(-a.relativeOffset / 60)])
        }
    }
    return [
        "id": e.eventIdentifier ?? "",
        "title": e.title ?? "",
        "calendarId": e.calendar?.calendarIdentifier ?? "",
        "calendarTitle": e.calendar?.title ?? "",
        "start": e.startDate.map(isoString) ?? NSNull(),
        "end": e.endDate.map(isoString) ?? NSNull(),
        "allDay": e.isAllDay,
        "location": e.location ?? NSNull(),
        "notes": e.notes ?? NSNull(),
        "url": e.url?.absoluteString ?? NSNull(),
        "isRecurring": e.hasRecurrenceRules,
        "alarms": alarms,
    ]
}

// MARK: - Command dispatch

func calendarsByIds(_ ids: [String]?) -> [EKCalendar]? {
    guard let ids = ids, !ids.isEmpty else { return nil }
    return store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
}

// Read whole stdin
let inputData = FileHandle.standardInput.readDataToEndOfFile()
guard
    let root = try? JSONSerialization.jsonObject(with: inputData) as? [String: Any],
    let command = root["command"] as? String
else { fail("BAD_INPUT", "Invalid JSON command"); exit(0) }
let args = (root["args"] as? [String: Any]) ?? [:]

switch command {
case "request-access":
    let status = EKEventStore.authorizationStatus(for: .event)
    if status == .fullAccess { ok(["granted": true]) }
    let granted = ensureAccess()
    ok(["granted": granted])

case "list-calendars":
    guard ensureAccess() else { fail("ACCESS_DENIED", "Calendar access not granted"); break }
    let def = store.defaultCalendarForNewEvents
    let cals = store.calendars(for: .event).map { c -> [String: Any] in
        [
            "id": c.calendarIdentifier,
            "title": c.title,
            "writable": c.allowsContentModifications,
            "isDefault": c.calendarIdentifier == def?.calendarIdentifier,
        ]
    }
    ok(cals)

default:
    fail("BAD_INPUT", "Unknown command: \(command)")
}
```

- [ ] **Step 4: Собрать хелпер**

```bash
npm run build:swift
```
Expected: сборка успешна, появляется `bin/calendar-helper`.

- [ ] **Step 5: Проверить вручную (запросит доступ к календарю)**

```bash
echo '{"command":"request-access"}' | ./bin/calendar-helper
echo '{"command":"list-calendars"}' | ./bin/calendar-helper
```
Expected: первый вызов покажет системный диалог; после разрешения `list-calendars` вернёт `{"ok":true,"data":[...]}` со списком календарей.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(swift): helper skeleton with access + list-calendars"
```

---

## Task 3: Swift-хелпер — чтение событий (list/search/get)

**Files:**
- Modify: `swift/Sources/CalendarHelper/main.swift` (добавить ветки в `switch`)

- [ ] **Step 1: Добавить ветки чтения перед `default:`**

```swift
case "list-events":
    guard ensureAccess() else { fail("ACCESS_DENIED", "Calendar access not granted"); break }
    guard let start = parseDate(args["start"] as? String),
          let end = parseDate(args["end"] as? String) else {
        fail("BAD_INPUT", "start and end (ISO8601) are required"); break
    }
    let cals = calendarsByIds(args["calendarIds"] as? [String])
    let pred = store.predicateForEvents(withStart: start, end: end, calendars: cals)
    let events = store.events(matching: pred).sorted { $0.startDate < $1.startDate }
    ok(events.map(serialize))

case "search-events":
    guard ensureAccess() else { fail("ACCESS_DENIED", "Calendar access not granted"); break }
    guard let query = (args["query"] as? String)?.lowercased(), !query.isEmpty else {
        fail("BAD_INPUT", "query is required"); break
    }
    // Период поиска: по умолчанию ±1 год от текущего момента
    let now = Date()
    let start = parseDate(args["start"] as? String) ?? now.addingTimeInterval(-365*24*3600)
    let end = parseDate(args["end"] as? String) ?? now.addingTimeInterval(365*24*3600)
    let cals = calendarsByIds(args["calendarIds"] as? [String])
    let pred = store.predicateForEvents(withStart: start, end: end, calendars: cals)
    let matched = store.events(matching: pred).filter { e in
        let hay = [e.title, e.notes, e.location].compactMap { $0?.lowercased() }.joined(separator: " ")
        return hay.contains(query)
    }.sorted { $0.startDate < $1.startDate }
    ok(matched.map(serialize))

case "get-event":
    guard ensureAccess() else { fail("ACCESS_DENIED", "Calendar access not granted"); break }
    guard let id = args["id"] as? String else { fail("BAD_INPUT", "id is required"); break }
    guard let e = store.event(withIdentifier: id) else { fail("NOT_FOUND", "Event not found: \(id)"); break }
    ok(serialize(e))
```

- [ ] **Step 2: Пересобрать**

```bash
npm run build:swift
```
Expected: успешная сборка.

- [ ] **Step 3: Проверить вручную**

```bash
echo '{"command":"list-events","args":{"start":"2026-06-01T00:00:00+03:00","end":"2026-06-30T23:59:59+03:00"}}' | ./bin/calendar-helper
echo '{"command":"search-events","args":{"query":"meeting"}}' | ./bin/calendar-helper
```
Expected: `{"ok":true,"data":[...]}` (возможно пустой массив).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(swift): read events (list/search/get)"
```

---

## Task 4: Swift-хелпер — запись (create/update/delete)

**Files:**
- Modify: `swift/Sources/CalendarHelper/main.swift` (добавить хелперы + ветки)

- [ ] **Step 1: Добавить хелперы построения алармов/повторов перед строкой `// Read whole stdin`**

```swift
// MARK: - Build helpers

func buildAlarms(_ raw: [[String: Any]]?) -> [EKAlarm] {
    guard let raw = raw else { return [] }
    var result: [EKAlarm] = []
    for a in raw {
        if let mins = a["minutesBefore"] as? Int {
            result.append(EKAlarm(relativeOffset: TimeInterval(-mins * 60)))
        } else if let at = a["at"] as? String, let d = parseDate(at) {
            result.append(EKAlarm(absoluteDate: d))
        }
    }
    return result
}

func weekday(_ s: String) -> EKWeekday? {
    switch s.lowercased() {
    case "su", "sunday": return .sunday
    case "mo", "monday": return .monday
    case "tu", "tuesday": return .tuesday
    case "we", "wednesday": return .wednesday
    case "th", "thursday": return .thursday
    case "fr", "friday": return .friday
    case "sa", "saturday": return .saturday
    default: return nil
    }
}

func buildRecurrence(_ raw: [String: Any]?) -> EKRecurrenceRule? {
    guard let raw = raw, let freqStr = raw["frequency"] as? String else { return nil }
    let freq: EKRecurrenceFrequency
    switch freqStr.lowercased() {
    case "daily": freq = .daily
    case "weekly": freq = .weekly
    case "monthly": freq = .monthly
    case "yearly": freq = .yearly
    default: return nil
    }
    let interval = (raw["interval"] as? Int) ?? 1
    let days = (raw["daysOfWeek"] as? [String])?.compactMap(weekday).map { EKRecurrenceDayOfWeek($0) }
    var end: EKRecurrenceEnd? = nil
    if let endObj = raw["end"] as? [String: Any] {
        if let untilStr = endObj["until"] as? String, let until = parseDate(untilStr) {
            end = EKRecurrenceEnd(end: until)
        } else if let count = endObj["count"] as? Int {
            end = EKRecurrenceEnd(occurrenceCount: count)
        }
    }
    return EKRecurrenceRule(
        recurrenceWith: freq, interval: max(1, interval),
        daysOfTheWeek: days, daysOfTheMonth: nil, monthsOfTheYear: nil,
        weeksOfTheYear: nil, daysOfTheYear: nil, setPositions: nil, end: end
    )
}

func spanFrom(_ s: String?) -> EKSpan {
    return s == "future" || s == "all" ? .futureEvents : .thisEvent
}

func applyFields(_ e: EKEvent, _ args: [String: Any]) -> String? {
    if let t = args["title"] as? String { e.title = t }
    if let a = args["allDay"] as? Bool { e.isAllDay = a }
    if let s = args["startDate"] as? String {
        guard let d = parseDate(s) else { return "Invalid startDate" }
        e.startDate = d
    }
    if let s = args["endDate"] as? String {
        guard let d = parseDate(s) else { return "Invalid endDate" }
        e.endDate = d
    }
    if args.keys.contains("location") { e.location = args["location"] as? String }
    if args.keys.contains("notes") { e.notes = args["notes"] as? String }
    if let u = args["url"] as? String { e.url = URL(string: u) }
    if let cid = args["calendarId"] as? String {
        guard let cal = store.calendars(for: .event).first(where: { $0.calendarIdentifier == cid }) else {
            return "Calendar not found: \(cid)"
        }
        e.calendar = cal
    }
    if let alarms = args["alarms"] as? [[String: Any]] { e.alarms = buildAlarms(alarms) }
    if args.keys.contains("recurrence") {
        if let rule = buildRecurrence(args["recurrence"] as? [String: Any]) {
            e.recurrenceRules = [rule]
        } else {
            e.recurrenceRules = nil
        }
    }
    return nil
}
```

- [ ] **Step 2: Добавить ветки записи перед `default:`**

```swift
case "create-event":
    guard ensureAccess() else { fail("ACCESS_DENIED", "Calendar access not granted"); break }
    guard args["title"] is String, args["startDate"] is String, args["endDate"] is String else {
        fail("BAD_INPUT", "title, startDate, endDate are required"); break
    }
    let e = EKEvent(eventStore: store)
    e.calendar = store.defaultCalendarForNewEvents
    if let err = applyFields(e, args) { fail("BAD_INPUT", err); break }
    if e.calendar == nil { fail("SAVE_FAILED", "No default calendar available"); break }
    do {
        try store.save(e, span: .thisEvent, commit: true)
        ok(serialize(e))
    } catch { fail("SAVE_FAILED", error.localizedDescription) }

case "update-event":
    guard ensureAccess() else { fail("ACCESS_DENIED", "Calendar access not granted"); break }
    guard let id = args["id"] as? String else { fail("BAD_INPUT", "id is required"); break }
    guard let e = store.event(withIdentifier: id) else { fail("NOT_FOUND", "Event not found: \(id)"); break }
    if let err = applyFields(e, args) { fail("BAD_INPUT", err); break }
    do {
        try store.save(e, span: spanFrom(args["span"] as? String), commit: true)
        ok(serialize(e))
    } catch { fail("SAVE_FAILED", error.localizedDescription) }

case "delete-event":
    guard ensureAccess() else { fail("ACCESS_DENIED", "Calendar access not granted"); break }
    guard let id = args["id"] as? String else { fail("BAD_INPUT", "id is required"); break }
    guard let e = store.event(withIdentifier: id) else { fail("NOT_FOUND", "Event not found: \(id)"); break }
    do {
        try store.remove(e, span: spanFrom(args["span"] as? String), commit: true)
        ok(["deleted": true, "id": id])
    } catch { fail("SAVE_FAILED", error.localizedDescription) }
```

- [ ] **Step 3: Пересобрать**

```bash
npm run build:swift
```
Expected: успешная сборка.

- [ ] **Step 4: Проверить вручную полный цикл**

```bash
echo '{"command":"create-event","args":{"title":"MCP test","startDate":"2026-06-10T15:00:00+03:00","endDate":"2026-06-10T16:00:00+03:00","alarms":[{"minutesBefore":15}]}}' | ./bin/calendar-helper
```
Expected: `{"ok":true,"data":{"id":"...",...}}`. Скопировать id, проверить update/delete:
```bash
echo '{"command":"delete-event","args":{"id":"<ID>"}}' | ./bin/calendar-helper
```
Expected: `{"ok":true,"data":{"deleted":true,...}}`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(swift): write events (create/update/delete)"
```

---

## Task 5: TS-обёртка helper.ts (TDD)

**Files:**
- Create: `tests/fixtures/fake-helper.mjs`, `tests/helper.test.ts`, `src/helper.ts`

- [ ] **Step 1: Записать поддельный хелпер `tests/fixtures/fake-helper.mjs`**

```js
#!/usr/bin/env node
// Читает JSON-команду из stdin, отвечает каноничным JSON в stdout.
let buf = "";
process.stdin.on("data", (c) => (buf += c));
process.stdin.on("end", () => {
  let cmd;
  try { cmd = JSON.parse(buf); } catch {
    process.stdout.write(JSON.stringify({ ok: false, code: "BAD_INPUT", error: "bad json" }));
    return;
  }
  if (cmd.command === "list-calendars") {
    process.stdout.write(JSON.stringify({ ok: true, data: [{ id: "c1", title: "Home", writable: true, isDefault: true }] }));
  } else if (cmd.command === "boom") {
    process.stdout.write(JSON.stringify({ ok: false, code: "NOT_FOUND", error: "nope" }));
  } else if (cmd.command === "echo") {
    process.stdout.write(JSON.stringify({ ok: true, data: cmd.args }));
  } else {
    process.stdout.write("not json at all");
  }
});
```

- [ ] **Step 2: Написать падающий тест `tests/helper.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runHelper, HelperError } from "../src/helper.js";

const here = dirname(fileURLToPath(import.meta.url));
const fake = join(here, "fixtures", "fake-helper.mjs");

describe("runHelper", () => {
  it("returns data on ok response", async () => {
    const data = await runHelper(fake, "list-calendars");
    expect(data).toEqual([{ id: "c1", title: "Home", writable: true, isDefault: true }]);
  });

  it("passes args through to the helper", async () => {
    const data = await runHelper(fake, "echo", { a: 1, b: "x" });
    expect(data).toEqual({ a: 1, b: "x" });
  });

  it("throws HelperError with code on failure", async () => {
    await expect(runHelper(fake, "boom")).rejects.toMatchObject({
      name: "HelperError",
      code: "NOT_FOUND",
      message: "nope",
    });
  });

  it("throws on unparseable helper output", async () => {
    await expect(runHelper(fake, "garbage")).rejects.toBeInstanceOf(HelperError);
  });
});
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `npx vitest run tests/helper.test.ts`
Expected: FAIL — `src/helper.js` не существует.

- [ ] **Step 4: Реализовать `src/helper.ts`**

```ts
import { spawn } from "node:child_process";

export class HelperError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HelperError";
    this.code = code;
  }
}

export interface HelperResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

export function runHelper(
  binPath: string,
  command: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => reject(new HelperError("INTERNAL", e.message)));
    child.on("close", () => {
      let parsed: HelperResponse;
      try {
        parsed = JSON.parse(out);
      } catch {
        reject(new HelperError("INTERNAL", `Bad helper output: ${out || err}`));
        return;
      }
      if (parsed.ok) resolve(parsed.data);
      else reject(new HelperError(parsed.code ?? "INTERNAL", parsed.error ?? "Unknown error"));
    });
    child.stdin.write(JSON.stringify({ command, args }));
    child.stdin.end();
  });
}
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `npx vitest run tests/helper.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ts): helper subprocess wrapper with tests"
```

---

## Task 6: Zod-схемы (TDD)

**Files:**
- Create: `tests/schemas.test.ts`, `src/schemas.ts`

- [ ] **Step 1: Написать падающий тест `tests/schemas.test.ts`**

```ts
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
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run tests/schemas.test.ts`
Expected: FAIL — `src/schemas.js` не существует.

- [ ] **Step 3: Реализовать `src/schemas.ts`**

```ts
import { z } from "zod";

export const alarmSchema = z
  .union([
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
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run tests/schemas.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ts): zod schemas with tests"
```

---

## Task 7: Форматирование ответов (TDD)

**Files:**
- Create: `tests/format.test.ts`, `src/format.ts`

- [ ] **Step 1: Написать падающий тест `tests/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatEvent, formatEventList, formatCalendars } from "../src/format.js";

const ev = {
  id: "E1", title: "Standup", calendarId: "c1", calendarTitle: "Work",
  start: "2026-06-10T15:00:00+03:00", end: "2026-06-10T15:15:00+03:00",
  allDay: false, location: null, notes: null, url: null, isRecurring: true, alarms: [],
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
    const s = formatCalendars([{ id: "c1", title: "Home", writable: true, isDefault: true }]);
    expect(s).toContain("Home");
    expect(s).toContain("default");
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — `src/format.js` не существует.

- [ ] **Step 3: Реализовать `src/format.ts`**

```ts
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
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ts): response formatting with tests"
```

---

## Task 8: Регистрация инструментов и точка входа

**Files:**
- Create: `src/tools/index.ts`, `src/index.ts`

- [ ] **Step 1: Реализовать `src/tools/index.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runHelper, HelperError } from "../helper.js";
import {
  createEventShape, updateEventShape, listEventsShape, searchEventsShape,
  idShape, deleteEventShape,
} from "../schemas.js";
import {
  formatEvent, formatEventList, formatCalendars,
  type CalendarEvent, type CalendarInfo,
} from "../format.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(e: unknown) {
  const msg = e instanceof HelperError ? `[${e.code}] ${e.message}` : String(e);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

export function registerTools(server: McpServer, binPath: string): void {
  const call = (command: string, args?: Record<string, unknown>) => runHelper(binPath, command, args);

  server.registerTool(
    "request_access",
    {
      description: "Request or check macOS Calendar access permission. Call this first if other tools return ACCESS_DENIED.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = (await call("request-access")) as { granted: boolean };
        return textResult(data.granted ? "Calendar access granted." : "Calendar access denied. Grant it in System Settings → Privacy & Security → Calendars.");
      } catch (e) { return errorResult(e); }
    }
  );

  server.registerTool(
    "list_calendars",
    { description: "List all available calendars with their ids, writability and default flag.", inputSchema: {} },
    async () => {
      try {
        const data = (await call("list-calendars")) as CalendarInfo[];
        return textResult(formatCalendars(data));
      } catch (e) { return errorResult(e); }
    }
  );

  server.registerTool(
    "list_events",
    { description: "List events between start and end (ISO 8601). Optionally filter by calendarIds.", inputSchema: listEventsShape },
    async (args) => {
      try {
        const data = (await call("list-events", args)) as CalendarEvent[];
        return textResult(formatEventList(data));
      } catch (e) { return errorResult(e); }
    }
  );

  server.registerTool(
    "search_events",
    { description: "Search events by text in title/notes/location. Optional start/end period (defaults to ±1 year).", inputSchema: searchEventsShape },
    async (args) => {
      try {
        const data = (await call("search-events", args)) as CalendarEvent[];
        return textResult(formatEventList(data));
      } catch (e) { return errorResult(e); }
    }
  );

  server.registerTool(
    "get_event",
    { description: "Get full details of a single event by id.", inputSchema: idShape },
    async (args) => {
      try {
        const data = (await call("get-event", args)) as CalendarEvent;
        return textResult(formatEvent(data));
      } catch (e) { return errorResult(e); }
    }
  );

  server.registerTool(
    "create_event",
    { description: "Create a calendar event. Dates in ISO 8601. Supports alarms and recurrence. Uses default calendar unless calendarId is given.", inputSchema: createEventShape },
    async (args) => {
      try {
        const data = (await call("create-event", args)) as CalendarEvent;
        return textResult(`Created:\n${formatEvent(data)}`);
      } catch (e) { return errorResult(e); }
    }
  );

  server.registerTool(
    "update_event",
    { description: "Update fields of an event by id. For recurring events set span: this | future | all (default this).", inputSchema: updateEventShape },
    async (args) => {
      try {
        const data = (await call("update-event", args)) as CalendarEvent;
        return textResult(`Updated:\n${formatEvent(data)}`);
      } catch (e) { return errorResult(e); }
    }
  );

  server.registerTool(
    "delete_event",
    { description: "Delete an event by id. For recurring events set span: this | future | all (default this).", inputSchema: deleteEventShape },
    async (args) => {
      try {
        await call("delete-event", args);
        return textResult(`Deleted event ${args.id}.`);
      } catch (e) { return errorResult(e); }
    }
  );
}
```

- [ ] **Step 2: Реализовать `src/index.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerTools } from "./tools/index.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/index.js → ../bin/calendar-helper
const binPath = process.env.CALENDAR_HELPER_PATH ?? join(here, "..", "bin", "calendar-helper");

const server = new McpServer({ name: "apple-calendar", version: "0.1.0" });
registerTools(server, binPath);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 3: Собрать и проверить компиляцию TS**

```bash
npm run build:ts
```
Expected: компиляция без ошибок, появляется `dist/index.js`.

- [ ] **Step 4: Smoke-тест MCP-сервера через initialize/tools/list**

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js
```
Expected: JSON-ответы; в `tools/list` присутствуют все 8 инструментов (`list_calendars`, `list_events`, `search_events`, `get_event`, `create_event`, `update_event`, `delete_event`, `request_access`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ts): register MCP tools and stdio entry point"
```

---

## Task 9: Интеграционный тест полного цикла

**Files:**
- Create: `tests/integration.test.ts`

- [ ] **Step 1: Реализовать `tests/integration.test.ts`**

Тест создаёт событие через бинарник, читает, обновляет, удаляет. Пропускается, если бинарник не собран или нет доступа.

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runHelper, HelperError } from "../src/helper.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "calendar-helper");

const hasBin = existsSync(bin);
const d = hasBin ? describe : describe.skip;

d("integration (macOS, requires Calendar access)", () => {
  let hasAccess = false;
  beforeAll(async () => {
    try {
      const r = (await runHelper(bin, "request-access")) as { granted: boolean };
      hasAccess = r.granted;
    } catch { hasAccess = false; }
  });

  it("create → get → update → delete round trip", async () => {
    if (!hasAccess) { console.warn("skip: no calendar access"); return; }
    const created = (await runHelper(bin, "create-event", {
      title: "MCP integration test",
      startDate: "2026-06-15T10:00:00+03:00",
      endDate: "2026-06-15T11:00:00+03:00",
      alarms: [{ minutesBefore: 10 }],
    })) as { id: string; title: string };
    expect(created.id).toBeTruthy();

    const fetched = (await runHelper(bin, "get-event", { id: created.id })) as { title: string };
    expect(fetched.title).toBe("MCP integration test");

    const updated = (await runHelper(bin, "update-event", {
      id: created.id, title: "MCP integration test (edited)",
    })) as { title: string };
    expect(updated.title).toBe("MCP integration test (edited)");

    const del = (await runHelper(bin, "delete-event", { id: created.id })) as { deleted: boolean };
    expect(del.deleted).toBe(true);

    await expect(runHelper(bin, "get-event", { id: created.id })).rejects.toBeInstanceOf(HelperError);
  });
});
```

- [ ] **Step 2: Запустить полный набор тестов**

Run: `npm test`
Expected: unit-тесты проходят; интеграционный — проходит при наличии доступа, иначе skip/warn.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: full round-trip integration test"
```

---

## Task 10: README и финальная сборка

**Files:**
- Create: `README.md`

- [ ] **Step 1: Записать `README.md`**

````markdown
# MCP Apple Calendar

MCP-сервер для работы с Apple Calendar (macOS) из Claude, Claude Code и любого MCP-клиента.
CRUD событий, несколько календарей, напоминания/алерты, повторяющиеся события.

## Требования

- macOS 14+
- Node.js 18+
- Swift toolchain (Xcode Command Line Tools: `xcode-select --install`)

## Сборка

```bash
npm install
npm run build   # компилирует Swift-хелпер + TypeScript
```

При первом запуске macOS запросит доступ к календарю. Если пропустили — выдайте
вручную: System Settings → Privacy & Security → Calendars.

## Подключение к клиентам

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

## Инструменты

`request_access`, `list_calendars`, `list_events`, `search_events`, `get_event`,
`create_event`, `update_event`, `delete_event`.

Даты — ISO 8601 (`2026-06-10T15:00:00+03:00`). Для повторяющихся событий
`update_event`/`delete_event` принимают `span`: `this` | `future` | `all`.

## Разработка

```bash
npm test            # unit + интеграционные тесты
npm run dev         # запуск сервера через tsx
```
````

- [ ] **Step 2: Финальная полная сборка и тесты**

```bash
npm run build && npm test
```
Expected: сборка успешна, все тесты зелёные (интеграционный — при наличии доступа).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: README with setup and client integration"
```

---

## Self-Review заметки

- **Покрытие спеки:** 8 инструментов ↔ Task 8; чтение (list/search/get) ↔ Task 3; запись ↔ Task 4; несколько календарей ↔ `calendarIds`/`calendarId`; алармы ↔ `alarmSchema` + `buildAlarms`; повторы ↔ `recurrenceSchema` + `buildRecurrence`; права доступа ↔ `request-access`/`ensureAccess`; ошибки ↔ `HelperError` + коды; даты ISO ↔ `parseDate`/`isoString`; тесты ↔ Tasks 5–7, 9.
- **Согласованность типов:** контракт `{ok,data,error,code}` единый для Swift и TS; имена команд (`list-events` и т.п.) совпадают между Swift `switch` и вызовами `call(...)`; поля `event` совпадают между `serialize` (Swift) и `CalendarEvent` (TS).
- **span:** одинаково трактуется в Swift (`spanFrom`) и схемах (`this|future|all`).
