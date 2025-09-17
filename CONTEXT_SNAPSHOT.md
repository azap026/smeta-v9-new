# Context Snapshot (15.09.2025)

Репозиторий: smeta-v9-new (branch: main)
Последний коммит: 3de9b8e — UI: LoaderOverlay; Calc: CPU-норматив и правила округления; фиксы линтера.

## Назначение и архитектура
- Приложение для ведения справочников работ и материалов и расчёта сметы.
- FE: React 19 + Vite (`src/`). BE: Express + pg (`server/`). PostgreSQL.
- Live-режим расчёта: используем нормативные связки `work_materials` как источник правды, без автоснимков (можно включить snapshots при необходимости).

## Быстрый старт на новом ПК
1) git clone https://github.com/azap026/smeta-v9-new.git
2) cd smeta-v9-new && npm install
3) Создайте .env с DATABASE_URL (пример: postgres://user:pass@localhost:5432/smeta)
4) npm run migrate (создаст/обновит схему)
5) Запуск: либо два процесса (npm run dev:api и npm run dev), либо совместно (npm run dev:all)
6) Откройте http://localhost:5173

Примечания по dev:
- Сервер стартует только при прямом запуске (main guard), чтобы избежать двойных запусков.
- Vite настроен с proxy на API; отключено кеширование ответов в dev.

## База данных (основные сущности) — см. `server/migrate.js`
- phases, stages, substages — иерархия групп.
- works_ref(id, name, unit, unit_price, stage_id, substage_id, sort_order)
- materials(id, name, unit, unit_price, expenditure, image_url, item_url, weight)
- work_materials(work_id, material_id, consumption_per_work_unit, waste_coeff)
- estimates, estimate_items, estimate_item_materials (для снапшотов смет — опционально)
- projects (код проекта, НДС и т.п.)

## Ключевые правила расчёта (актуально)
- Норматив (CPU) = `work_materials.consumption_per_work_unit`.
- Кол-во материала = CPU × Кол-во работ.
- Округление: для отображения и сумм берём округление вверх до целого (ceil).
- Коэффициент отходов сейчас не применяется (wc исключён из формулы).
- Поле `materials.expenditure` справочное, в расчёт не входит (можно выводить отдельно при необходимости).
- В UI колонка “Норматив (CPU)” редактируемая; колонка “Кол-во” — вычисляемая, read-only.

## API (выдержка из `server/index.js`)
- Debug/health: GET /api/health, GET /api/debug-counts, GET /api/debug-db?work_id=
- Works tree: GET /api/works-rows (постранично)
- Works admin: POST /api/admin/import, GET /api/admin/export-works-ref, POST /api/admin/clear, PATCH/GET/DELETE /api/admin/work-ref/:id
- Materials: GET /api/materials (page,q), GET /api/materials/search, POST/PATCH/DELETE /api/materials
- Normative links: 
  - GET /api/work-materials/:work_id — материалы работы с CPU, ценой и мета
  - POST /api/work-materials — upsert пары (work_id, material_id, CPU, waste_coeff)
  - POST /api/work-materials/replace — атомарная замена material_id в связке
  - DELETE /api/work-materials/:work_id/:material_id — точечное удаление связки
  - Импорт/экспорт связок: POST /api/admin/import-work-materials (CSV), GET /api/admin/export-work-materials
- Estimates snapshots (опционально): POST/GET /api/estimates/by-code/current/full
- Projects: GET/POST /api/projects (создание проекта)

CSV конвенции:
- Разделитель `;`, BOM поддерживается.
- Импорт связок принимает заголовки: work_id;material_id;consumption_per_work_unit;waste_coeff.

## Frontend ключевые файлы
- `src/App.jsx` — вкладки: Расчет сметы, Справочник работ, Справочник материалов, Создать проект.
  - Расчет сметы: блоки работ загружают материалы из /api/work-materials/:work_id; колонка “Норматив (CPU)” редактирует CPU; “Кол-во” = ceil(CPU × workQty); суммы считаются по округлённому количеству.
  - Замена материала — через палитру с POST /api/work-materials/replace, CPU/WC переносятся при необходимости.
  - Импорт/экспорт/очистка связок доступны в UI.
- `src/components/LoaderOverlay.tsx` + `src/styles/loader.css` — единый оверлей загрузки (подключён в `src/main.jsx`). Показ при загрузке вкладок works/materials.
- `src/components/VirtualizedTBody.jsx` — виртуализация строк таблиц; авто-байпас при печати и малом числе строк. Высоты/overscan — `src/virtualizationConfig.js`.
- `src/components/MaterialAutocomplete.jsx` — поиск материалов; поддержка replace-флоу.
- `src/components/ui/FloatingWindow.jsx` — модалки с overlay и drag; сохраняют позицию.
- `src/components/CreateProject.jsx` — форма создания проекта.

## Импорт/экспорт
- Работы: POST /api/admin/import (CSV) и GET /api/admin/export-works-ref.
- Материалы: GET/POST /api/materials; экспорт см. /api/admin/export-materials.
- Связки работа-материал: POST /api/admin/import-work-materials, GET /api/admin/export-work-materials.

## Виртуализация и печать
- Используем @tanstack/react-virtual для tbody. Для печати виртуализация отключается (beforeprint/afterprint; matchMedia("print")).
- Порог для байпаса: <= max(overscan*2, 40) строк.

## Известные нюансы
- Избегайте параллельного запуска нескольких бэкендов — есть guard, но в dev:all при повторных стартах возможны конфликты портов.
- В dev кэширование отключено в proxy, чтобы видеть свежие данные.

## Быстрые проверки
- Линт: npm run lint (на момент снапшота — 0 ошибок/варнингов)
- Health: GET http://127.0.0.1:4000/api/health
- UI: Вкладка calc — проверьте отображение CPU/Кол-во и суммы.

## Как продолжить диалог с ИИ на другом ПК
- В новом чате укажите: "см. CONTEXT_SNAPSHOT.md (15.09.2025)".
- Если измените правила/схему — обновите этот файл и `docs/virtualization.md` при необходимости.

---
Актуально на: 15.09.2025
