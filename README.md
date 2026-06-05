# MCP Apple Calendar

MCP-сервер для работы с Apple Calendar (macOS) из Claude, Claude Code и любого MCP-клиента.
CRUD событий, несколько календарей, напоминания/алерты, повторяющиеся события.

Реализация: TypeScript MCP-сервер (stdio) + скомпилированный Swift-хелпер на EventKit.

## Требования

- macOS 14+
- Node.js 18+
- Swift toolchain (Xcode Command Line Tools: `xcode-select --install`)

## Сборка

```bash
npm install
npm run build   # компилирует Swift-хелпер + TypeScript
```

При первом обращении к календарю macOS запросит доступ. Если пропустили диалог —
выдайте права вручную: System Settings → Privacy & Security → Calendars.

Можно проверить доступ из терминала:

```bash
echo '{"command":"request-access"}' | ./bin/calendar-helper
```

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

> По умолчанию хелпер ищется в `../bin/calendar-helper` относительно `dist/index.js`.
> Путь можно переопределить переменной окружения `CALENDAR_HELPER_PATH`.

## Инструменты

| Инструмент | Назначение |
|---|---|
| `request_access` | Запросить/проверить доступ к календарю |
| `list_calendars` | Список календарей (id, writable, default) |
| `list_events` | События за период (`start`, `end` ISO 8601, опц. `calendarIds`) |
| `search_events` | Поиск по тексту (`query`, опц. период и `calendarIds`) |
| `get_event` | Детали события по `id` |
| `create_event` | Создать событие |
| `update_event` | Изменить событие по `id` |
| `delete_event` | Удалить событие по `id` |

### Формат данных

- **Даты** — ISO 8601 со смещением: `2026-06-10T15:00:00+03:00`. Для `allDay`
  достаточно даты `2026-06-10`.
- **Алармы** (`alarms`) — массив: относительные `{"minutesBefore": 15}` или
  абсолютные `{"at": "2026-06-10T14:45:00+03:00"}`.
- **Повторы** (`recurrence`):
  ```json
  {
    "frequency": "daily | weekly | monthly | yearly",
    "interval": 1,
    "daysOfWeek": ["mo", "we", "fr"],
    "end": { "until": "2026-12-31T00:00:00+03:00" }
  }
  ```
  Вместо `until` можно указать `{ "count": 10 }`.
- **span** — для повторяющихся событий `update_event`/`delete_event` принимают
  `span`: `this` (по умолчанию) | `future` | `all`.

## Разработка

```bash
npm test            # unit + интеграционные тесты (vitest)
npm run dev         # запуск сервера через tsx без сборки
```

Интеграционный тест создаёт/читает/обновляет/удаляет временное событие в
календаре по умолчанию и убирает за собой. Если бинарник не собран или доступ
не выдан — тест пропускается.

## Архитектура

```
AI-клиент ──stdio (JSON-RPC)──► MCP-сервер (TS) ──spawn + JSON──► Swift-хелпер (EventKit)
```

- `src/` — MCP-сервер: `helper.ts` (вызов бинарника), `schemas.ts` (zod),
  `format.ts` (форматирование), `tools/` (инструменты), `index.ts` (точка входа).
- `swift/Sources/CalendarHelper/main.swift` — CLI на EventKit: принимает одну
  JSON-команду через stdin, возвращает `{ok, data}` / `{ok:false, error, code}`.
