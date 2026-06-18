# Консолидация сделок — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Довести `/deals` до паритета с вкладкой «Сделки» в клиентах (создание, AI-поиск, фильтры, показ отменённых/удалённых) и удалить вкладку из клиентов.

**Architecture:** Серверная страница грузит все сделки + опции клиентов и отдаёт в клиентскую доску; фильтрация на клиенте. Переиспользуем готовые `DealEditDialog` и `DiscoverDealsDialog`.

**Tech Stack:** Next.js 16 / React 19, shadcn/ui, @dnd-kit, Drizzle.

**Verification:** тест-раннера нет — `corepack pnpm exec tsc --noEmit` + `corepack pnpm lint` + `corepack pnpm build` + ручные сценарии.

**Контракт между задачами:** `clientOptions` в `DealsBoard` делаем **опциональным** (`= []`), чтобы каждая задача компилировалась независимо от порядка.

---

## File Structure
- Modify `src/components/blocks/deal-kanban-card.tsx` — неактивные сделки (disabled drag + бейдж + dim).
- Modify `src/components/blocks/deals-board.tsx` — фильтры, кнопки, показ неактивных.
- Modify `src/app/(protected)/deals/page.tsx` — грузить все сделки + опции клиентов.
- Modify `src/app/(protected)/clients/page.tsx` — удалить вкладку «Сделки» + чистка.
- Delete `src/components/blocks/deal-card.tsx` — больше не используется.

---

## Task 1: Карточка — поддержка неактивных сделок

**File:** Modify `src/components/blocks/deal-kanban-card.tsx`

- [ ] **Step 1: Заменить содержимое файла на:**

```tsx
"use client"

import { useDraggable } from "@dnd-kit/core"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Building2, User, Pencil } from "lucide-react"
import type { DealRow } from "@/app/api/deals/route"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DealProvenance } from "@/components/blocks/deal-provenance"
import { formatAmount } from "@/lib/deal-board"

// Сумма + клиент + владелец — общий блок для карточки и превью DragOverlay.
function CardMeta({ deal }: { deal: DealRow }) {
  const amount = formatAmount(deal.value, deal.currency)
  return (
    <>
      {amount && <div className="text-sm font-semibold">{amount}</div>}
      <div className="space-y-1 text-xs text-muted-foreground">
        {deal.clientName && (
          <div className="flex items-center gap-1.5 truncate">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{deal.clientName}</span>
          </div>
        )}
        {deal.userName && (
          <div className="flex items-center gap-1.5 truncate">
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{deal.userName}</span>
          </div>
        )}
      </div>
    </>
  )
}

export function DealKanbanCard({
  deal,
  onChanged,
}: {
  deal: DealRow
  onChanged: () => void
}) {
  // Неактивные (отменённые/удалённые) сделки показываем приглушённо и НЕ даём
  // перетаскивать — перевод стадии только для активных.
  const isActive = deal.status === "active"
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !isActive,
  })

  return (
    <Card
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`p-3 space-y-2 bg-card border-muted ${
        isActive ? "cursor-grab active:cursor-grabbing" : "opacity-60"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-snug">{deal.name}</div>
        <DealEditDialog
          mode="edit"
          deal={deal}
          onSuccess={onChanged}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              aria-label="Редактировать сделку"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          }
        />
      </div>

      {deal.status === "cancelled" && (
        <Badge
          variant="secondary"
          className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"
        >
          Отменена
        </Badge>
      )}
      {deal.status === "deleted" && (
        <Badge
          variant="secondary"
          className="bg-red-500/15 text-red-600 dark:text-red-300"
        >
          Удалена
        </Badge>
      )}

      <CardMeta deal={deal} />

      <div className="flex flex-wrap gap-1">
        <DealProvenance deal={deal} />
      </div>
    </Card>
  )
}

// Превью карточки под курсором при перетаскивании (DragOverlay).
export function DealKanbanCardOverlay({ deal }: { deal: DealRow }) {
  return (
    <Card className="w-64 p-3 space-y-2 bg-card border-muted shadow-xl rotate-2 cursor-grabbing">
      <div className="text-sm font-medium leading-snug">{deal.name}</div>
      <CardMeta deal={deal} />
    </Card>
  )
}
```

- [ ] **Step 2:** `corepack pnpm exec tsc --noEmit` → без ошибок.
- [ ] **Step 3:** Commit
```
git add src/components/blocks/deal-kanban-card.tsx
git commit -m "feat: показ неактивных сделок на канбане (dim + бейдж, без drag)"
```

---

## Task 2: Доска — фильтры, кнопки, показ неактивных

**File:** Modify `src/components/blocks/deals-board.tsx`

- [ ] **Step 1: Заменить содержимое файла на:**

```tsx
"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type {
  DealRow,
  DealFunnelStageOption,
  DealClientOption,
} from "@/app/api/deals/route"
import { dealStageLabel } from "@/lib/deal-funnel"
import {
  STAGE_COLOR,
  STAGE_DEFAULT,
  dealAmount,
  filterByOwner,
  formatAggregate,
  isTerminalStage,
  moveDirection,
  weightedForecast,
  type OwnerFilter,
} from "@/lib/deal-board"
import {
  DealKanbanCard,
  DealKanbanCardOverlay,
} from "@/components/blocks/deal-kanban-card"
import {
  DealMoveDialog,
  type PendingMove,
} from "@/components/blocks/deal-move-dialog"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DiscoverDealsDialog } from "@/components/blocks/discover-deals-dialog"

const ALL = "__all__"

function Column({
  stage,
  deals,
  onChanged,
}: {
  stage: DealFunnelStageOption
  deals: DealRow[]
  onChanged: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const sum = deals.reduce((a, d) => a + dealAmount(d.value), 0)
  const weighted = sum * stage.closureProbability
  const colorClass = STAGE_COLOR[stage.name] ?? STAGE_DEFAULT

  return (
    <div className="w-64 shrink-0 flex flex-col gap-2">
      <div className={`rounded-lg border p-2.5 ${colorClass}`}>
        <div className="flex items-baseline justify-between text-sm font-medium">
          <span>{dealStageLabel(stage.name)}</span>
          <span className="text-xs opacity-70">
            {Math.round(stage.closureProbability * 100)}%
          </span>
        </div>
        <div className="text-xs opacity-80 mt-0.5">
          {deals.length} · {formatAggregate(sum)} · взвеш.{" "}
          {formatAggregate(weighted)}
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 min-h-24 rounded-lg p-1 transition-colors ${
          isOver ? "outline outline-2 outline-dashed outline-primary" : ""
        }`}
      >
        {deals.map((d) => (
          <DealKanbanCard key={d.id} deal={d} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

export function DealsBoard({
  deals,
  stages,
  currentUserId,
  clientOptions = [],
}: {
  deals: DealRow[]
  stages: DealFunnelStageOption[]
  currentUserId: string
  clientOptions?: DealClientOption[]
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<OwnerFilter>("all")
  const [query, setQuery] = useState("")
  const [clientFilter, setClientFilter] = useState<string>(ALL)
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // Базовый набор: владелец → поиск (название/описание) → клиент.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return filterByOwner(deals, filter, currentUserId).filter((d) => {
      if (clientFilter !== ALL && d.clientId !== clientFilter) return false
      if (q) {
        const inName = d.name.toLowerCase().includes(q)
        const inDesc = (d.description ?? "").toLowerCase().includes(q)
        if (!inName && !inDesc) return false
      }
      return true
    })
  }, [deals, filter, currentUserId, query, clientFilter])

  // Активные — для прогноза, счётчика, drag и терминальной полки.
  const activeDeals = useMemo(
    () => filtered.filter((d) => d.status === "active"),
    [filtered],
  )

  // Что рендерим в колонках: активные всегда + отменённые/удалённые по тогглам,
  // на их собственной стадии (funnelStageId).
  const boardDeals = useMemo(
    () =>
      filtered.filter((d) => {
        if (d.status === "active") return true
        if (d.status === "cancelled") return includeCancelled
        if (d.status === "deleted") return includeDeleted
        return false
      }),
    [filtered, includeCancelled, includeDeleted],
  )

  const flowStages = stages.filter((s) => !isTerminalStage(s.name))
  const terminalStages = stages.filter((s) => isTerminalStage(s.name))

  const forecast = useMemo(
    () => weightedForecast(activeDeals, stages),
    [activeDeals, stages],
  )
  const openCount = activeDeals.filter(
    (d) => !isTerminalStage(d.funnelStageName),
  ).length

  const dealsByStage = (stageId: string) =>
    boardDeals.filter((d) => d.funnelStageId === stageId)

  const activeDeal = activeId
    ? (activeDeals.find((d) => d.id === activeId) ?? null)
    : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const deal = activeDeals.find((d) => d.id === active.id)
    const toStage = stages.find((s) => s.id === over.id)
    if (!deal || !toStage) return
    if (deal.funnelStageId === toStage.id) return
    if (isTerminalStage(toStage.name)) {
      toast("Терминальные стадии защищены — закрытие через карточку сделки")
      return
    }
    const fromStage = stages.find((s) => s.id === deal.funnelStageId)
    setPendingMove({
      dealId: deal.id,
      dealName: deal.name,
      toStageId: toStage.id,
      fromLabel: dealStageLabel(fromStage?.name ?? ""),
      toLabel: dealStageLabel(toStage.name),
      direction: moveDirection(fromStage?.sortOrder ?? 0, toStage.sortOrder),
    })
  }

  function confirmMove(note: string) {
    if (!pendingMove) return
    const move = pendingMove
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: move.dealId,
            move: true,
            funnelStageId: move.toStageId,
            note,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось перевести сделку")
          return
        }
        toast.success(`Переведено: ${move.toLabel}`)
        setPendingMove(null)
        router.refresh()
      } catch {
        toast.error("Не удалось перевести сделку")
      }
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-4 flex-wrap">
            <h1 className="text-lg font-semibold uppercase tracking-wide">
              Сделки
            </h1>
            <span className="text-sm text-muted-foreground">
              взвешенный прогноз{" "}
              <b className="text-foreground">{formatAggregate(forecast)}</b> ·
              открытых: <b className="text-foreground">{openCount}</b>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <DiscoverDealsDialog
              onDealsGenerated={router.refresh}
              trigger={
                <Button size="sm" variant="default">
                  <Sparkles className="h-4 w-4 mr-1" />
                  Найти в источниках
                </Button>
              }
            />
            <DealEditDialog
              mode="create"
              onSuccess={router.refresh}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Новая сделка
                </Button>
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border overflow-hidden">
            <Button
              variant={filter === "all" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none"
              onClick={() => setFilter("all")}
            >
              Все
            </Button>
            <Button
              variant={filter === "mine" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none"
              onClick={() => setFilter("mine")}
            >
              Мои
            </Button>
          </div>
          <Input
            placeholder="Поиск по названию или описанию…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-45"
          />
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger size="sm" className="w-fit">
              <SelectValue placeholder="Клиент" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все клиенты</SelectItem>
              {clientOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              checked={includeCancelled}
              onCheckedChange={(v) => setIncludeCancelled(Boolean(v))}
            />
            Отменённые
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              checked={includeDeleted}
              onCheckedChange={(v) => setIncludeDeleted(Boolean(v))}
            />
            Удалённые
          </label>
        </div>
      </div>

      <DndContext
        id="deals-board"
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex-1 min-h-0 flex gap-2 overflow-x-auto px-4 pb-4 items-start">
          {flowStages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              deals={dealsByStage(stage.id)}
              onChanged={router.refresh}
            />
          ))}

          {terminalStages.length > 0 && (
            <div className="w-44 shrink-0 flex flex-col gap-2">
              <div className="rounded-lg border p-2.5 bg-muted/40">
                <div className="text-sm font-medium">Итоги</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  терминальные стадии
                </div>
              </div>
              {terminalStages.map((stage) => {
                const items = activeDeals.filter(
                  (d) => d.funnelStageId === stage.id,
                )
                const sum = items.reduce((a, d) => a + dealAmount(d.value), 0)
                return (
                  <div
                    key={stage.id}
                    className={`rounded-lg p-2.5 text-sm ${
                      STAGE_COLOR[stage.name] ?? STAGE_DEFAULT
                    }`}
                  >
                    <div className="font-medium">
                      {dealStageLabel(stage.name)} · {items.length}
                    </div>
                    <div className="text-xs opacity-80">
                      {formatAggregate(sum)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DragOverlay>
          {activeDeal ? <DealKanbanCardOverlay deal={activeDeal} /> : null}
        </DragOverlay>
      </DndContext>

      <DealMoveDialog
        move={pendingMove}
        pending={isPending}
        onConfirm={confirmMove}
        onCancel={() => setPendingMove(null)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Проверить, что `SelectTrigger` принимает проп `size`.** Открыть `src/components/ui/select.tsx`; если `SelectTrigger` НЕ принимает `size`, убрать `size="sm"` из `<SelectTrigger>` (оставить только `className="w-fit"`).
- [ ] **Step 3:** `corepack pnpm exec tsc --noEmit` → без ошибок.
- [ ] **Step 4:** Commit
```
git add src/components/blocks/deals-board.tsx
git commit -m "feat: фильтры, создание и AI-поиск сделок в канбане"
```

---

## Task 3: Страница /deals — грузить все сделки + опции клиентов

**File:** Modify `src/app/(protected)/deals/page.tsx`

- [ ] **Step 1: Заменить содержимое файла на:**

```tsx
import {
  listDeals,
  listDealFunnelStages,
  listDealClientOptions,
} from "@/server/deals"
import { getServerSession } from "@/lib/get-session"
import { DealsBoard } from "@/components/blocks/deals-board"

export default async function DealsPage() {
  const [deals, stages, clientOptions, session] = await Promise.all([
    listDeals({ includeCancelled: true, includeDeleted: true }),
    listDealFunnelStages(),
    listDealClientOptions(),
    getServerSession(),
  ])
  const currentUserId = session?.user.id ?? ""

  return (
    <div className="h-[calc(100vh-1rem)]">
      <DealsBoard
        deals={deals}
        stages={stages}
        currentUserId={currentUserId}
        clientOptions={clientOptions}
      />
    </div>
  )
}
```

- [ ] **Step 2: Проверить, что `listDealClientOptions` экспортируется из `@/server/deals`** (использовалось в `/api/deals?clientOptions=1`). Тип `DealClientOption` уже реэкспортируется из `@/app/api/deals/route`.
- [ ] **Step 3:** `corepack pnpm exec tsc --noEmit` → без ошибок.
- [ ] **Step 4:** Commit
```
git add "src/app/(protected)/deals/page.tsx"
git commit -m "feat: /deals грузит все сделки и опции клиентов"
```

---

## Task 4: Удалить вкладку «Сделки» из клиентов + чистка

**Files:** Modify `src/app/(protected)/clients/page.tsx`; Delete `src/components/blocks/deal-card.tsx`

Цель: страница клиентов показывает только секции «Клиенты» и «Контакты»; весь
deals-код удалён; неиспользуемый `deal-card.tsx` удалён.

- [ ] **Step 1: Удалить из `clients/page.tsx` всё, относящееся к сделкам:**
  - Импорты: `DealEditDialog`, `DiscoverDealsDialog`, `DealCard`, `dealStageLabel`, типы `DealRow`/`DealClientOption`/`DealFunnelStageOption`, `Checkbox` (если больше не используется), и иконки, оставшиеся без употребления.
  - Стейт и логику: `deals`, `dealStages`, `dealClientOptions`, `dealQueryFilter`, `dealClientFilter`, `dealIncludeCancelled`, `dealIncludeDeleted`, `loadDeals`, deal-вызовы внутри `refreshAll`/`useEffect` (оставить только clients/contacts), `filteredDeals`, `dealsByStage`, `salesFunnelValue`, `hasDealFilters`, `clearDealFilters`.
  - JSX: убрать `<TabsTrigger value="deals">` и весь `<TabsContent value="deals">…</TabsContent>`.
  - Вспомогательный компонент `DealStageBucket` (в конце файла) удалить.
- [ ] **Step 2: Свернуть `Tabs` до прямого рендера.** Если после удаления остаётся единственная вкладка «Клиенты и контакты» — убрать обёртку `Tabs/TabsList/TabsTrigger/TabsContent` и рендерить две карточки (Клиенты, Контакты) напрямую. Если так проще и безопаснее — допустимо оставить один `Tabs` с одной вкладкой, но предпочтительно убрать обёртку. Убрать неиспользуемые импорты `Tabs*`, если обёртка удалена.
- [ ] **Step 3: Удалить файл** `src/components/blocks/deal-card.tsx`:
```
git rm src/components/blocks/deal-card.tsx
```
  Предварительно подтвердить `grep -rn "deal-card\|DealCard" src` — единственное употребление должно быть в clients (которое удаляется этим таском).
- [ ] **Step 4: Проверка**
  - `corepack pnpm exec tsc --noEmit` → без ошибок (никаких «unused»/«not found»).
  - `corepack pnpm lint` → без новых ошибок по `clients/page.tsx`.
- [ ] **Step 5:** Commit
```
git add "src/app/(protected)/clients/page.tsx"
git commit -m "refactor: убрать вкладку «Сделки» из клиентов (переехала в /deals)"
```

---

## Task 5: Финальная проверка

- [ ] **Step 1:** `corepack pnpm build` → EXIT 0, «Compiled successfully», маршруты `/deals` и `/clients` присутствуют.
- [ ] **Step 2: Ручной smoke (нужна сессия):**
  - `/deals`: кнопки «Новая сделка» и «Найти в источниках» открывают диалоги; создание/генерация → доска обновляется.
  - Поиск и фильтр по клиенту сужают карточки; «Все/Мои» работает.
  - Чекбоксы «Отменённые»/«Удалённые» показывают такие сделки в их колонке, приглушённо, с бейджем, без drag.
  - `/clients`: вкладки «Сделки» больше нет; клиенты и контакты на месте.
- [ ] **Step 3:** Commit (если остались несведённые изменения)
```
git add -A && git commit -m "chore: финализация консолидации сделок"
```

---

## Self-review
- Паритет: создание (Task 2), AI-поиск (Task 2), фильтры поиск/клиент/тогглы (Task 2), показ неактивных (Task 1+2), данные (Task 3); удаление вкладки + чистка + удаление `deal-card.tsx` (Task 4). Прогноз/счётчик считают активные (Task 2).
- Контракт `clientOptions?` опционален → задачи компилируются в любом порядке.
- Типы: `DealClientOption` из `@/app/api/deals/route`; `DealEditDialog` default + `DiscoverDealsDialog` named — сверено.
