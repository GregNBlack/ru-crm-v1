# Детальная вьюха сделки (drawer) — дизайн

Дата: 2026-06-29
Статус: одобрено к реализации
Ветка: `feature/deal-detail-drawer`

## Контекст и цель

В `/deals` нет места для полного просмотра сделки — карточка показывает только
сводку, по клику ничего не происходит (только drag). Нужна **детальная вьюха**:
клик по карточке открывает боковую панель (drawer) с полной информацией и
действиями по сделке.

## Решения (с заказчиком)

- **Контейнер:** боковая панель (shadcn `Sheet`, справа), не отдельная страница.
- **Объём 1-й итерации:** база (сводка + перевод стадии + редактирование) +
  контакты с ролями + связанные задачи/след. шаг + документы (КП/ТЗ) + лента событий.
- **Реализация:** одна спека, план разбит на фазы A→B→C→D (инкрементально).

## Ограничения (учтены честно)

- **Истории изменений нет** — `deal.reasoning`/`changes` перезаписываются при каждом
  переводе. Настоящая лента требует append-only журнала → вводим таблицу `deal_event`
  (заодно фундамент будущей «ленты решений» AI). Бэкфилла нет: события копятся **с
  момента релиза**.
- **Нет связи сделка↔исходный источник** в схеме — клик к письму-первоисточнику пока
  невозможен. Лента показывает залогированные события + задачи + документы.

## Вход и сосуществование с drag&drop

- Клик по карточке открывает drawer. dnd-kit `PointerSensor` с `activationConstraint
  { distance: 5 }`: нажатие без сдвига = клик (открыть), сдвиг ≥5px = перетаскивание.
- Кнопка-карандаш и бейдж «происхождение» вызывают `e.stopPropagation()` (как сейчас),
  чтобы не открывать drawer и не стартовать drag.
- Неактивные (отменённые/удалённые) карточки тоже открываются в drawer (read-only по
  смыслу, но просмотр доступен).

## Раскладка drawer

- **Шапка:** компания · продукт (название сделки) · сумма · бейдж стадии · статус ·
  ответственный · кнопка «Редактировать» (reuse `DealEditDialog`, `mode="edit"`).
- **Перевод по воронке:** `Select` со стадиями (reuse `moveDealStage`); недоступен для
  неактивных сделок.
- **Вкладки** (shadcn `Tabs`):
  - **Сводка** — описание + происхождение (`reasoning`/`changes`, дата, автор).
  - **Контакты** — список контактов сделки с ролями; добавить/убрать контакт, назначить роль.
  - **Задачи** — список задач сделки (`task.dealId`); «следующий шаг» = ближайший
    `todo` по `dueDate`, либо алерт «нет следующего шага».
  - **Документы** — список вложений (КП/ТЗ/прочее); загрузка/удаление.
  - **Лента** — хроно-лента из `deal_event` + задачи + документы.

## Изменения схемы

1. **enum `deal_contact_role`** + колонка `role` (nullable) на `deal_contact`:
   значения `decision_maker, influencer, expert, initiator, economic_buyer, champion,
   blocker, user, gatekeeper`. RU-ярлыки (UI-карта, имена в БД английские, по аналогии
   с `dealStageLabel`):
   - ЛПР, ЛВПР, Эксперт, Инициатор, Экономический покупатель, Чемпион, Блокировщик,
     Пользователь, Секретарь.
2. **таблица `deal_document`:** `id, dealId (cascade), name, kind (enum: kp/tz/other),
   r2Key, sizeBytes, uploadedByUserId, organizationId, createdAt`.
3. **таблица `deal_event`** (append-only): `id, dealId (cascade), type (enum:
   stage_moved/document_added/contact_role_set/created/edited), text, actor (enum:
   user/agent/system), actorUserId (nullable), organizationId, createdAt`.

## Серверный слой (`@/server/deals` и смежные)

- `getDealDetail(dealId)` → `{ deal, contacts: [{...contact, role}], tasks, documents, events }`.
- Контакты: `addDealContact(dealId, contactId)`, `setDealContactRole(dealId, contactId, role|null)`,
  `removeDealContact(dealId, contactId)`.
- Документы: загрузка через R2 (reuse паттерн `uploadSourceItem`), `addDealDocument`,
  `removeDealDocument`; download — отдача по `r2Key`.
- `moveDealStage` дополнительно пишет `deal_event(type=stage_moved)`; добавление
  документа и смена роли — свои события.
- Задачи: `listDealTasks(dealId)` (фильтр `task.dealId`) или фильтр существующего
  `listTasks()`.

## API / роуты

- Деталь: новый `GET /api/deals/[id]` → `getDealDetail` (отдельный роут, чтобы не
  перегружать существующий `GET /api/deals`).
- Контакты-роли: `PUT /api/deals/[id]/contacts` (set role / add / remove).
- Документы: `POST/DELETE /api/deals/[id]/documents` (+ download-роут).

## Файлы (ориентир)

```
src/components/blocks/deal-detail-drawer.tsx   — Sheet-обёртка + вкладки
src/components/blocks/deal-contacts-roles.tsx  — вкладка «Контакты»
src/components/blocks/deal-documents.tsx       — вкладка «Документы»
src/components/blocks/deal-events-feed.tsx     — вкладка «Лента»
src/lib/deal-roles.ts                          — RU-ярлыки ролей
```
+ изменения в `deals-board.tsx` (открытие drawer по клику), `server/deals.ts`,
`db/schema.ts`, новые роуты под `src/app/api/deals/[id]/`.

## Фазовая раскладка плана

- **Фаза A:** drawer-каркас (Sheet + вкладки) + сводка + перевод стадии + редактирование
  + вкладка «Задачи». Без новых таблиц. → первый видимый результат, клик по карточке работает.
- **Фаза B:** контакты с ролями (enum+role в схеме, server, вкладка UI).
- **Фаза C:** документы (таблица `deal_document` + R2 + вкладка UI).
- **Фаза D:** лента событий (`deal_event` + запись событий в мутациях + вкладка UI).

## Не входит (следующие итерации)

- Прогноз закрытия (срок) + алерт задержки; светофор риска (нужна аналитика/история).
- BANT-квалификация и соответствие ICP (AI-анализ переписки).
- Предложения агента и автоприменение (отдельный блок «AI-лента»).
- Глубокие ссылки на первоисточники (нужна модель связи deal↔sourceItem).

## Тестирование

Тест-раннера нет (решение). Проверка: `tsc --noEmit` + `lint` + `build` + ручные
сценарии (открытие drawer, перевод стадии, роли, загрузка документа, лента).
