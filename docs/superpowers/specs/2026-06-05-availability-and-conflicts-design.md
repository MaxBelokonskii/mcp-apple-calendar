# Поиск свободных слотов, детектор конфликтов и двуязычный README — дизайн

**Дата:** 2026-06-05

## Цель

Расширить MCP Apple Calendar двумя инструментами планирования и добавить
английскую версию README.

1. `find_free_slots` — найти свободные окна заданной длительности в диапазоне дат.
2. `check_conflicts` — найти события, пересекающие заданный интервал; плюс
   автоматическое предупреждение о конфликтах в `create_event`/`update_event`.
3. Двуязычный README (английский основной + русский).

## Контекст и отклонённая фича

Изначально обсуждалось «добавление контактов (участников) к событию». Это
**невозможно** через EventKit: свойство `attendees` доступно только для чтения
(«it is not possible to add attendees with Event Kit»). Фича отклонена.

## Ключевое решение: вычисления на стороне TypeScript

Обе фичи — вычисления над списком событий, который хелпер уже отдаёт командой
`list-events`. Реализуем в TypeScript новым модулем чистых функций. Swift-хелпер
**не трогаем** — меньше риска, проще TDD.

```
find_free_slots / check_conflicts → helper.list-events(range) → чистые функции (availability.ts) → результат
```

## Правило: all-day события не считаются занятостью

События «на весь день» (`allDay: true`, например праздники) **не блокируют**
конкретное время. В расчёте свободных слотов и конфликтов учитываются только
события с конкретным временем (`allDay: false`).

## Компоненты

- **`src/availability.ts`** — чистые функции (без I/O):
  - `mergeBusy(intervals: Interval[]): Interval[]` — слить пересекающиеся/смежные интервалы (отсортировать по началу, объединить).
  - `eventsToBusy(events: CalendarEvent[]): Interval[]` — отфильтровать all-day и события без start/end, превратить в интервалы `{start: ms, end: ms}`.
  - `computeFreeSlots(events, rangeStartMs, rangeEndMs, durationMs): Interval[]` — свободные окна ≥ durationMs внутри `[rangeStart, rangeEnd]`, как дополнение к объединённой занятости.
  - `findOverlapping(events, targetStartMs, targetEndMs, excludeId?): CalendarEvent[]` — события с конкретным временем, пересекающие `[targetStart, targetEnd)`, кроме `excludeId`.
  - Хелпер `overlaps(aStart, aEnd, bStart, bEnd): boolean` — `aStart < bEnd && bStart < aEnd`.
- **`src/schemas.ts`** — `findFreeSlotsShape`, `checkConflictsShape`.
- **`src/format.ts`** — `formatFreeSlots(slots)`, `formatConflicts(events)`.
- **`src/tools/index.ts`** — инструменты `find_free_slots`, `check_conflicts`;
  в `create_event`/`update_event` после сохранения — блок `⚠️ Conflicts:`.

### Типы

```ts
export interface Interval { start: number; end: number } // epoch ms
```

`CalendarEvent` — уже существует в `src/format.ts`.

## Инструменты

| Инструмент | Аргументы | Результат |
|---|---|---|
| `find_free_slots` | `start`, `end` (ISO), `durationMinutes` (int>0), опц. `calendarIds` | Список свободных окон ≥ длительности |
| `check_conflicts` | `start`, `end` (ISO), опц. `calendarIds`, опц. `excludeEventId` | Пересекающие события |

**Поведение `create_event`/`update_event`:** после успешного сохранения вызвать
`list-events` для интервала `[event.start, event.end]`, выполнить `findOverlapping`
исключая сам event по `id`. Если есть пересечения — добавить в текст ответа блок
`⚠️ Conflicts:` со списком. Сохранение не блокируется.

## Поток данных (find_free_slots)

1. `runHelper(bin, "list-events", {start, end, calendarIds})` → `CalendarEvent[]`.
2. `eventsToBusy` (отсечь all-day) → `Interval[]`.
3. `computeFreeSlots(events, parse(start), parse(end), durationMinutes*60000)`.
4. `formatFreeSlots` → текст.

Парсинг ISO → ms через `Date.parse` (валидные ISO-строки с offset). Если
`Date.parse` вернул `NaN` — инструмент возвращает ошибку `[BAD_INPUT] ...`.

## README

- `README.md` → английский (основной для GitHub), с шапкой-переключателем
  `English | [Русский](README.ru.md)`.
- `README.ru.md` → текущий русский контент, шапка `[English](README.md) | Русский`.
- Оба файла описывают все инструменты, включая `find_free_slots` и `check_conflicts`.

## Обработка ошибок

- Невалидные даты → `[BAD_INPUT]` (через тот же `errorResult`/текст).
- `durationMinutes <= 0` отсекается схемой zod.
- Ошибки `list-events` пробрасываются как `HelperError` и форматируются `errorResult`.

## Тестирование

- **`tests/availability.test.ts`** — чистые функции:
  - `mergeBusy`: пустой вход; один интервал; пересекающиеся; смежные (touching); непересекающиеся; неотсортированные.
  - `computeFreeSlots`: нет событий → весь диапазон; событие в середине → два окна; окна короче duration отбрасываются; события вне диапазона игнорируются; частичное пересечение с границей диапазона; all-day игнорируется.
  - `findOverlapping`: пересечение; касание границы (не конфликт); excludeId; all-day игнорируется.
- **`tests/tools-availability.test.ts`** (опц.) — через расширенный fake-helper:
  `find_free_slots`/`check_conflicts` end-to-end на фиктивных событиях.
- Существующие тесты должны остаться зелёными.

## Вне объёма

- Рабочие часы/дни (по решению — круглосуточный поиск).
- Участники событий (read-only/запись) — отклонено.
- Учёт таймзон сложнее ISO-offset (полагаемся на корректные ISO-строки).
