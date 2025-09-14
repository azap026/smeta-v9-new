# Copilot Instructions for smeta-v9-new

## Назначение и архитектура
- Приложение для ведения справочников работ (фазы/стадии/подстадии) и расчёта сметы.
- Frontend: React 19 + Vite (`src/`), Backend: Express + pg (`server/`).
- Основные сущности: phases, stages, substages, works_ref, materials.
- Вся бизнес-логика API — в `server/index.js`. Структура БД — см. `server/migrate.js`.

## Ключевые developer workflow
- Быстрый старт:
  1. `npm install`
  2. `npm run migrate` (создать схему)
  3. `npm run dev:api` (backend) и `npm run dev` (frontend) — либо `npm run dev:all` для одновременного запуска.
- Для импорта/экспорта работ используйте UI или API:
  - Импорт: POST `/api/admin/import` (CSV, разделитель `;`, BOM поддерживается)
  - Экспорт: GET `/api/admin/export-works-ref` (CSV с BOM)
- Очистка справочников: POST `/api/admin/clear`
- Проверка состояния: GET `/api/debug-counts`

## Конвенции и паттерны
- CSV импорт/экспорт строго с разделителем `;`. Excel может менять формат — следить.
- Валидация: строки без work_id/work_name пропускаются, ошибки с номером строки.
- Для предотвращения дубликатов работ используйте GET `/api/admin/work-ref/:id`.
- В UI модалки используют `FloatingWindow` с сохранением позиции в localStorage.
- Вкладки UI: "calc", "works", "materials". Дерево работ строится из /api/works-rows.
- Автосохранение изменений работ — debounce 800ms, PATCH `/api/admin/work-ref/:id`.
- Для сортировки фаз используется поле `sort_order`.
 - Виртуализация таблиц: используйте `VirtualizedTBody` (см. `src/components/VirtualizedTBody.jsx`).
   - Настройки overscan и высот строк централизованы в `src/virtualizationConfig.js`.
   - Для печати (`window.print`) виртуализация отключается автоматически.

## Важные файлы и директории
- `src/App.jsx` — основной UI, обработка вкладок, импорт/экспорт, работа с API.
- `src/components/ui/FloatingWindow.jsx` — плавающее окно, overlay, drag&drop.
- `src/components/AddWorkModal.jsx/tsx` — добавление/редактирование работ.
- `src/components/VirtualizedTBody.jsx` — виртуализированный `<tbody>` с a11y, печатью и автоизмерением высоты строк.
- `src/virtualizationConfig.js` — конфиг высот строк и overscan для таблиц.
- `docs/virtualization.md` — документация по виртуализации.
- `server/index.js` — все API endpoints, бизнес-логика.
- `server/importer.js` — логика импорта CSV.
- `server/migrate.js` — миграции и структура БД.

## Интеграция и зависимости
- Backend: Express, pg, multer, csv-parse/sync.
- Frontend: React, Vite.
- Для запуска требуется PostgreSQL, настройте `DATABASE_URL` в `.env`.

## Примеры
- Импорт работ через UI: загрузите CSV, дождитесь статистики (imported, skippedRows).
- Добавление работы: используйте модалку, live-проверка дубликатов.
- Экспорт работ: скачайте CSV через кнопку или API.

---
Актуально на 13.09.2025. При изменениях обновляйте этот файл и `CONTEXT_SNAPSHOT.md`.
