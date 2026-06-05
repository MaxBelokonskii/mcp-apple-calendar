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
    store.requestFullAccessToEvents { isGranted, _ in granted = isGranted; sem.signal() }
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

func calendarsByIds(_ ids: [String]?) -> [EKCalendar]? {
    guard let ids = ids, !ids.isEmpty else { return nil }
    return store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
}

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

// MARK: - Command dispatch

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
    let now = Date()
    let start = parseDate(args["start"] as? String) ?? now.addingTimeInterval(-365 * 24 * 3600)
    let end = parseDate(args["end"] as? String) ?? now.addingTimeInterval(365 * 24 * 3600)
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

default:
    fail("BAD_INPUT", "Unknown command: \(command)")
}
