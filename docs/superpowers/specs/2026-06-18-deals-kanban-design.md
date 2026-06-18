# Канбан сделок — дизайн (итерация 1)

Дата: 2026-06-18
Статус: одобрено к реализации
Ветка: `feature/deals-kanban`

## Контекст

В проекте `ru-crm-v1` (Next.js 16 / React 19, shadcn/ui + Radix + Tailwind 4, Drizzle)
уже есть бэкенд сделок, но нет канбан-страницы. Текущий UI сделок — список карточек
с переводом по воронке через выпадающий список (`DealCard`), без доски и без drag&drop.

Источник вдохновения — прототип `deal-kanban_1.html` (AI-native доска). Из него берётся
**взаимодействие и структура**, но НЕ кастомная тёмная палитра: рендерим на shadcn-токенах
со светлой/тёмной темой приложения. Стадии берём реальные (из БД), а не из прототипа.

## Что уже есть (переиспользуем)

- Таблица `deal`: `name, description, reasoning, changes, funnelStageId, value, currency,
  status (active/cancelled/deleted), clientId, userId, createdAt, updatedAt`.
- Таблица `deal_funnel_stage`: настраиваемая по оргам воронка, `closureProbability`,
  `sortOrder`, `isSystem`, `isActive`. Системные стадии (англ. имена в БД, рус. ярлыки в
  `src/lib/deal-funnel.ts`): Квалификация → Выявление потребностей → Пилот → КП →
  Переговоры → Закрыта → Проиграна.
- API: `GET /api/deals` (`deals`, `funnelStages`), `PUT /api/deals` (обновление, в т.ч.
  `funnelStageId`). Типы `DealRow`, `DealFunnelStageOption` экспортируются из `@/server/deals`.
- Компоненты `DealCard`, `DealEditDialog`; `dealStageLabel()`; `ModeSwitcher` (тема).

`DealRow` содержит всё нужное для доски: `funnelStageName`, `funnelStageProbability`,
`value`, `currency`, `clientName`, `userName`, `reasoning`, `changes`, `status`, `updatedAt`.

## Решения (зафиксированы с заказчиком)

- **Объём итерации 1:** визуальная доска на реальных данных.
- **Drag&drop:** `@dnd-kit` (MIT, большая аудитория, активная поддержка, a11y + touch).
- **Перевод стадии:** лёгкое подтверждение — диалог «X → Y»; вперёд комментарий
  опционален, назад причина обязательна; текст пишется в provenance.
- **Рендеринг:** RSC-страница грузит данные на сервере, клиентский компонент доски на dnd-kit;
  мутации через `PUT /api/deals` + `router.refresh()`.

## Архитектура и файлы

```
src/app/(protected)/deals/page.tsx        — RSC: грузит deals + stages, рендерит доску
src/components/blocks/deals-board.tsx      — 'use client': DndContext, колонки, прогноз, фильтр
src/components/blocks/deal-kanban-card.tsx — компактная draggable-карточка
src/components/blocks/deal-move-dialog.tsx — лёгкое подтверждение перевода стадии
src/components/blocks/deal-provenance.tsx  — поповер происхождения (reasoning/changes/источник)
```

Изменение: пункт «Сделки» (`/deals`) добавляется в `items` в `src/components/blocks/app-sidebar.tsx`,
позиция — после «Клиенты». Иконка — `SquareKanban` из lucide (при отсутствии в версии — `Workflow`).

### page.tsx (RSC)
- Серверно вызывает `listDeals()` и `listDealFunnelStages()`.
- Передаёт `deals`, `stages`, `currentUserId` в `<DealsBoard>`.

### deals-board.tsx ('use client')
- `DndContext` (dnd-kit) + колонка-`droppable` на стадию + карточка-`draggable`.
- Колонки строятся из `stages` по `sortOrder`. Терминальные стадии (Закрыта/Проиграна)
  выносятся в узкую «полку» справа; drop в неё запрещён.
- Заголовок колонки: ярлык стадии · вероятность % · кол-во · сумма · взвешенная сумма.
- Пустые нетерминальные колонки — свёрнутые/узкие (как в прототипе).
- Шапка: взвешенный прогноз (Σ `value`×`probability`), число открытых сделок,
  переключатель «Все / Мои» (фильтр по `currentUserId`).
- На drop — открывает `DealMoveDialog`; на подтверждение шлёт мутацию и `router.refresh()`.

### deal-kanban-card.tsx
- Компактная карточка: название, сумма (`formatAmount`), клиент, владелец.
- Бейдж provenance (если есть `reasoning`/`changes`) → `DealProvenance` поповер.
- Редактирование — существующий `DealEditDialog`.
- Состояния dnd: `dragging` (полупрозрачность), drop-таргет подсветка колонки.

### deal-move-dialog.tsx
- Заголовок «{name}: {from} → {to}». Направление определяется по `sortOrder`.
- Вперёд: `Textarea` комментария (опционально). Назад: `Textarea` причины (обязательно,
  кнопка подтверждения заблокирована, пока пусто).
- На подтверждение вызывает мутацию перевода стадии с заметкой.

### deal-provenance.tsx
- Поповер с полями: что изменилось (`changes`), обоснование (`reasoning`),
  источник/время (`updatedAt`), владелец (`userName`). Только чтение.

## Доработка бэкенда (малая, контейнерная)

Текущий `PUT /api/deals` / `updateDeal` не принимает ручной `changes`/`reasoning`.
Добавляем серверное действие `moveDealStage(id, stageId, note, direction)` в `@/server/deals`:
- ставит `funnelStageId`, обновляет `updatedAt`;
- пишет заметку перевода в `changes` — фиксирует основание (поле `reasoning` остаётся
  за discovery-агентом, ручной перевод его не трогает);
- экспонируется через `PUT /api/deals` новой веткой `move: true` (по аналогии с
  существующей веткой `statusOnly`), без отдельного route.

Существующее поведение `updateDeal` не меняется.

## Тема и стиль

- Только shadcn-токены (`bg-card`, `text-muted-foreground`, `border`, `bg-muted/50` и т.п.).
- Светлая/тёмная тема как в приложении. Плотная компоновка в духе прототипа.
- Цвета стадий — переиспользуем карту `STAGE_COLOR` из `deal-card.tsx` (вынести в общий модуль,
  чтобы не дублировать).

## Явно отложено (следующие итерации)

- Предложения агента (ghost-карточки accept/reject) — требует доработки discovery-бэкенда.
- Лента решений (audit feed) — нет таблицы событий.
- Постадийные чеклисты-коммитменты — нет данных о коммитментах в БД.
- Индикатор «остывания» сделки — нет данных о норме дней на стадию.
- Инвариант «нет следующего шага» — требует join с задачами (`task.dealId`).

## Тестирование

- Unit: расчёт взвешенного прогноза; фильтр «Все/Мои»; определение направления перевода.
- Smoke: рендер `/deals` с непустыми данными без ошибок.
- E2E drag&drop отложен — в проекте нет e2e-харнеса (не вводим в этой итерации).

## Не входит в дизайн

- Переработка существующего списочного UI сделок (если он используется где-то ещё) —
  не трогаем в этой итерации.
- Кастомизация воронки под оргу — уже поддержана на уровне БД, UI не добавляем.
