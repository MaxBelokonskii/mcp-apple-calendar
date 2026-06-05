# MCP-сервер для Apple Calendar — дизайн

**Дата:** 2026-06-05

## Цель

MCP-сервер, позволяющий любому AI-агенту (Claude Desktop, Claude Code и др.)
получать, создавать, редактировать и удалять события в Apple Calendar на macOS.

## Ключевые решения

- **Рантайм:** TypeScript / Node.js, официальный `@modelcontextprotocol/sdk`, транспорт stdio.
- **Доступ к календарю:** скомпилированный Swift-хелпер на EventKit, вызываемый из Node как subprocess.
- **Дистрибуция:** локально из исходников; в конфиге клиента прописывается путь `node + dist/index.js`.
- **Объём v1:** CRUD событий, несколько календарей, напоминания/алерты, повторяющиеся события.
- **Вне объёма v1:** участники/приглашения (attendees), отдельное приложение Reminders.

## Архитектура

```
AI-клиент  ──stdio (JSON-RPC)──►  MCP-сервер (TS, Node)  ──spawn + JSON──►  Swift-хелпер (EventKit CLI)
```

1. **MCP-сервер (TypeScript)** — общается с клиентом по stdio, описывает инструменты,
   валидирует вход через `zod`, форматирует ответы и ошибки.
2. **Swift-хелпер** — маленький CLI на EventKit. Принимает одну JSON-команду через stdin,
   возвращает JSON. Вся работа с календарём здесь.

**Почему EventKit, а не AppleScript:** нативная поддержка recurrence rules и alarms,
стабильные `eventIdentifier`, корректная работа с правами доступа macOS (TCC).

### Структура каталогов

```
mcp-apple-calendar/
├── src/                      # TypeScript MCP-сервер
│   ├── index.ts              # точка входа, регистрация tools, stdio
│   ├── helper.ts             # обёртка: spawn Swift-бинарника, JSON in/out
│   ├── schemas.ts            # zod-схемы аргументов
│   └── tools/                # по инструменту на файл
├── swift/
│   ├── Package.swift
│   └── Sources/CalendarHelper/main.swift
├── bin/calendar-helper       # скомпилированный бинарник (продукт сборки)
├── package.json              # build: компилит Swift + TS
└── README.md                 # инструкция подключения к клиентам
```

## Инструменты MCP

| Инструмент | Назначение |
|---|---|
| `list_calendars` | Список календарей (id, имя, цвет, writable) |
| `list_events` | События за период (start/end ISO, опц. фильтр по календарям) |
| `search_events` | Поиск по тексту в title/notes/location (+ опц. период) |
| `get_event` | Полные детали события по id |
| `create_event` | Создать событие |
| `update_event` | Изменить поля события по id (для повторяющихся — span: this/future/all) |
| `delete_event` | Удалить событие (для повторяющихся — span: this/future/all) |
| `request_access` | Запросить/проверить разрешение доступа к календарю |

### Модель события (create/update)

- `title`, `startDate`, `endDate` (ISO 8601), `allDay` (bool)
- `calendarId` (если не указан — дефолтный), `location`, `notes`, `url`
- `alarms`: массив — относительные (`{minutesBefore: 15}`) или абсолютные (`{at: ISO}`)
- `recurrence`: `{frequency: daily|weekly|monthly|yearly, interval, daysOfWeek?, end?: {until: ISO | count: N}}`

## Даты, ошибки, права доступа

- **Даты/таймзоны:** ISO 8601 со смещением (`2026-06-10T15:00:00+03:00`).
  Для `allDay` — только дата. Хелпер работает в системной таймзоне.
- **Права доступа (TCC):** при первом обращении macOS покажет диалог.
  `request_access` инкапсулирует запрос. Запрашиваем full access (чтение+запись).
  Без доступа инструменты возвращают понятную ошибку с инструкцией.
- **Ошибки:** хелпер всегда возвращает `{ok: true, data}` или `{ok: false, error, code}`.
  TS-слой маппит в MCP-ошибки с человекочитаемым текстом.

## Тестирование

- **TS-слой:** unit-тесты с замоканным subprocess (сборка команд, валидация zod, маппинг ошибок). TDD.
- **Swift-хелпер + интеграция:** интеграционный тест создаёт/читает/удаляет событие
  в выделенном тестовом календаре и убирает за собой. Только на macOS с выданным доступом.
