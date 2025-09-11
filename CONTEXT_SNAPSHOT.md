# Context Snapshot (11.09.2025)

## Репозиторий
- Name: smeta-v9-new
- Branch: main
- Last commit: 956eb5f "feat(works-ref): floating window modal, strict create & CSV export/import with stats; add diagnostics and skipped rows tracking"

## Назначение
Приложение для ведения справочников работ (иерархия фаз/стадий/подстадий) и дальнейшего расчёта сметы. Есть импорт/экспорт CSV справочника работ, UI для добавления работ в реальном времени, предотвращение дубликатов.

## Технологии
- Frontend: React 19 + Vite
- Backend: Express + pg (PostgreSQL)
- Парсинг CSV: csv-parse/sync
- Загрузка файлов: multer

## Структура БД (см. `server/migrate.js`)
```
phases(id PK, name, sort_order)
stages(id PK, name, phase_id -> phases)
substages(id PK, name, stage_id -> stages)
works_ref(id PK, name, unit, unit_price, phase_id, stage_id, substage_id)
works, works_groups (отдельный функционал)
```

## Основные эндпоинты (server/index.js)
- GET /api/health
- GET /api/phases | /api/stages?phase_id= | /api/substages?stage_id=
- GET /api/works-ref (фильтрация по phase_id/stage_id/substage_id)
- GET /api/works-rows (плоское дерево для UI)
- GET /api/debug-counts
- POST /api/admin/clear (truncate справочников)
- POST /api/admin/import (multipart/form-data, field=file)
- GET  /api/admin/export-works-ref (CSV с BOM)
- POST /api/admin/upsert-work-ref (создать/обновить одну работу + иерархию)
- GET  /api/admin/work-ref/:id (проверка существования)
- POST /api/admin/create-work-ref (строгое создание — 409 при дубликате)

## Импорт CSV (`server/importer.js`)
- Формат (разделитель `;`, BOM поддерживается):
  `work_id;work_name;unit;unit_price;phase_id;phase_name;stage_id;stage_name;substage_id;substage_name`
- Логика: upsert фаз/стадий/подстадий (один раз за файл), upsert работы.
- Статистика возвращается: imported, skippedRows, inserted/updatedPhases|Stages|Substages|Works.
- Валидация: строки без work_id или work_name пропускаются (skippedRows).
- Диагностика: при ошибке выбрасывается сообщение с номером строки и work_id.

## Экспорт CSV
- Эндпоинт `/api/admin/export-works-ref` возвращает BOM UTF-8.
- Поля соответствуют формату импорта, безопасные кавычки при спецсимволах.

## Frontend (ключевое)
### `src/components/ui/FloatingWindow.jsx`
- Плавающее окно (portal), перетаскивание, сохранение позиции (persistKey) в localStorage, опциональный overlay.

### `src/components/AddWorkModal.(tsx|jsx)`
- Использует FloatingWindow.
- Ввод work_id/work_name/unit/unit_price + опциональные phase/stage/substage.
- Live проверка дубликатов (через GET /api/admin/work-ref/:id) — (план: можно расширить).

### `src/App.jsx`
- Вкладки: calc | works | materials.
- Вкладка works: дерево групп/работ (из /api/works-rows).
- Импорт CSV: <input type=file> → POST /api/admin/import, показ статистики.
- Экспорт CSV: кнопка скачивания.
- Очистка БД: POST /api/admin/clear.
- Debug counts: GET /api/debug-counts.
- Добавление работы: модалка (upsert-work-ref).
- Column resize для таблицы.

## Скрипты (package.json)
- `dev` (vite)
- `dev:api` (nodemon backend)
- `dev:all` (concurrently vite + server) — убедиться, что команда правильная (использует "npm:dev" и "npm:dev:api"/"npm:server" в текущей версии).
- `migrate` — создание схемы.

## Быстрый старт на новом ПК
1. `git clone https://github.com/azap026/smeta-v9-new.git`
2. `cd smeta-v9-new`
3. Создать `.env` на основе `.env.example` и проставить корректный `DATABASE_URL` (можно без `sslmode=require` локально).
4. `npm install`
5. `npm run migrate`
6. В двух терминалах: `npm run dev:api` и `npm run dev` (или `npm run dev:all`).
7. Открыть http://localhost:5173 (по умолчанию Vite) и вкладку "Работы".

## Возможные улучшения (backlog)
- Строгий режим импорта (только вставка, без обновлений) через query флаг.
- Постраничная пагинация на сервере для works-rows при большой выборке.
- Отдельные индексы по (phase_id, stage_id, substage_id) комбинациям (производительность фильтров).
- Детализированный отчёт об ошибках импорта (массив проблемных строк вместо единой ошибки).
- Кеширование справочника в памяти (ETag/If-None-Match) — сейчас отключено кэширование.
- UI: подсветка новых/обновлённых работ после импорта.
- Materials: интеграция с реальным источником.

## Важные моменты
- При пустой таблице phases UI всё ещё строит дерево из стадий/подстадий (fallback логика).
- CSV строго с разделителем `;` — Excel при сохранении может изменить формат (следить).
- Для корректной сортировки фаз используется поле sort_order (пока всегда 0 если не указан).

## Как продолжить диалог с ИИ на другом ПК
- В первом сообщении нового чата сослаться на файл `CONTEXT_SNAPSHOT.md`.
- Добавлять сюда заметки по мере изменений.

---
Актуально на момент: 11.09.2025
