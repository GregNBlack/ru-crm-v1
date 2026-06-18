# Канбан сделок — план реализации (итерация 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новая страница `/deals` — канбан-доска сделок с drag&drop, взвешенным прогнозом, provenance и лёгким подтверждением перевода стадии, поверх существующего бэкенда.

**Architecture:** RSC-страница грузит сделки и стадии на сервере и отдаёт в клиентский компонент доски на `@dnd-kit/core`. Мутации идут через расширенный `PUT /api/deals` (ветка `move: true`) + `router.refresh()`. Чистая логика (прогноз, фильтр, направление перевода) вынесена в модуль-хелпер.

**Tech Stack:** Next.js 16 / React 19, shadcn/ui + Radix + Tailwind 4, Drizzle, `@dnd-kit/core`, lucide-react, sonner.

**Тестирование:** тест-раннер в проект не вводим (решение заказчика). Проверка каждой задачи — `corepack pnpm exec tsc --noEmit` (типы) + `corepack pnpm lint` (где затронут existing-код) + ручная проверка на dev-сервере. Логика держится в чистых функциях для лёгкой ручной проверки.

**Допущение по валюте:** агрегаты (прогноз, суммы колонок) считаются по числовым `value` и форматируются как `₽` (единая валюта). Мультивалютность — следующая итерация.

**Команды (pnpm через corepack):**
- типы: `corepack pnpm exec tsc --noEmit`
- линт: `corepack pnpm lint`
- dev: `corepack pnpm dev` (уже может быть запущен на :3000)

---

## File Structure

- Create `src/lib/deal-board.ts` — чистые хелперы + общие константы (цвета стадий, формат сумм, прогноз, фильтр, направление, терминальные стадии).
- Modify `src/components/blocks/deal-card.tsx` — переключить на импорт `STAGE_COLOR`/`STAGE_DEFAULT`/`formatAmount`/`CURRENCY_SYMBOL` из `deal-board.ts` (убрать дубли).
- Modify `src/server/deals.ts` — добавить `moveDealStage(dealId, funnelStageId, note)`.
- Modify `src/app/api/deals/route.ts` — ветка `move: true` в `PUT`.
- Create `src/components/blocks/deal-provenance.tsx` — поповер происхождения.
- Create `src/components/blocks/deal-kanban-card.tsx` — draggable-карточка.
- Create `src/components/blocks/deal-move-dialog.tsx` — диалог подтверждения перевода.
- Create `src/components/blocks/deals-board.tsx` — доска: `DndContext`, колонки, прогноз, фильтр, терминальная полка.
- Create `src/app/(protected)/deals/page.tsx` — RSC: грузит данные, рендерит доску.
- Modify `src/components/blocks/app-sidebar.tsx` — пункт «Сделки».

---

## Task 1: Установить @dnd-kit/core

**Files:** Modify `package.json`, `pnpm-lock.yaml` (через менеджер).

- [ ] **Step 1: Установить зависимость**

Run: `corepack pnpm add @dnd-kit/core`
Expected: пакет добавлен в `dependencies`, lock обновлён, установка без ошибок.

- [ ] **Step 2: Проверить, что приложение собирается**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без новых ошибок типов.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: добавить @dnd-kit/core для канбана сделок"
```

---

## Task 2: Модуль-хелпер deal-board.ts + рефактор deal-card.tsx

**Files:**
- Create: `src/lib/deal-board.ts`
- Modify: `src/components/blocks/deal-card.tsx`

- [ ] **Step 1: Создать `src/lib/deal-board.ts`**

```ts
import type { DealRow, DealFunnelStageOption } from "@/server/deals"

// Терминальные (закрывающие) системные стадии — в доске выносятся на отдельную
// полку, drop в них запрещён. Имена соответствуют английским именам стадий в БД.
export const TERMINAL_STAGE_NAMES = ["Closed", "Rejected"] as const

export function isTerminalStage(stageName: string): boolean {
  return (TERMINAL_STAGE_NAMES as readonly string[]).includes(stageName)
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CHF: "CHF ",
  CAD: "CA$",
  AUD: "A$",
}

// Цвета стадий — по английскому имени стадии. Кастомные стадии орги падают
// в нейтральный default. (Перенесено из deal-card.tsx, чтобы не дублировать.)
export const STAGE_COLOR: Record<string, string> = {
  Qualification: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  Discovery: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  Pilot: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  Proposal: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  Negotiations: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  Closed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  Rejected: "bg-red-500/15 text-red-600 dark:text-red-300",
}
export const STAGE_DEFAULT = "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"

export function formatAmount(
  value: string | null,
  currency: string,
): string | null {
  if (value === null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const symbol = CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}

// Числовое значение сделки для агрегатов (0, если пусто/некорректно).
export function dealAmount(value: string | null): number {
  if (value === null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Форматирование агрегата (прогноз, сумма колонки) — единая валюта ₽.
export function formatAggregate(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`
}

// Взвешенный прогноз: Σ value × вероятность, по активным НЕтерминальным сделкам.
// closureProbability — доля 0..1.
export function weightedForecast(
  deals: DealRow[],
  stages: DealFunnelStageOption[],
): number {
  const probByStageId = new Map(stages.map((s) => [s.id, s.closureProbability]))
  let total = 0
  for (const d of deals) {
    if (d.status !== "active") continue
    if (isTerminalStage(d.funnelStageName)) continue
    const prob = probByStageId.get(d.funnelStageId) ?? d.funnelStageProbability
    total += dealAmount(d.value) * prob
  }
  return total
}

export type OwnerFilter = "all" | "mine"

export function filterByOwner(
  deals: DealRow[],
  filter: OwnerFilter,
  currentUserId: string,
): DealRow[] {
  if (filter === "all") return deals
  return deals.filter((d) => d.userId === currentUserId)
}

export type MoveDirection = "fwd" | "back"

// Направление перевода по sortOrder стадий. Равный/больший порядок — вперёд.
export function moveDirection(
  fromSortOrder: number,
  toSortOrder: number,
): MoveDirection {
  return toSortOrder >= fromSortOrder ? "fwd" : "back"
}
```

- [ ] **Step 2: Переключить `deal-card.tsx` на общий модуль**

В `src/components/blocks/deal-card.tsx` удалить локальные объявления `STAGE_COLOR`, `STAGE_DEFAULT`, `CURRENCY_SYMBOL`, `formatAmount` (строки ~28–65) и импортировать их из модуля. Добавить в начало (рядом с импортом `dealStageLabel`):

```ts
import {
  STAGE_COLOR,
  STAGE_DEFAULT,
  formatAmount,
} from "@/lib/deal-board"
```

Остальной код `deal-card.tsx` не меняется (использует те же имена).

- [ ] **Step 3: Проверить типы**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без ошибок (deal-card.tsx использует импортированные символы).

- [ ] **Step 4: Линт затронутого файла**

Run: `corepack pnpm lint`
Expected: без новых предупреждений по `deal-card.tsx` / `deal-board.ts`.

- [ ] **Step 5: Ручная проверка существующего экрана**

Открыть `/clients` (там используется `DealCard`), убедиться, что карточки сделок отображаются как прежде (цвета стадий, сумма).

- [ ] **Step 6: Commit**

```bash
git add src/lib/deal-board.ts src/components/blocks/deal-card.tsx
git commit -m "refactor: вынести хелперы сделок в lib/deal-board"
```

---

## Task 3: Серверное действие moveDealStage + ветка move в API

**Files:**
- Modify: `src/server/deals.ts`
- Modify: `src/app/api/deals/route.ts`

- [ ] **Step 1: Добавить `moveDealStage` в `src/server/deals.ts`**

В конец файла (после `setDealStatus`, ~строка 519) добавить:

```ts
// Перевод сделки по воронке вручную (drag&drop в канбане). Ставит стадию,
// пишет заметку-основание в `changes` (provenance ручного перевода) и
// обновляет updatedAt. `reasoning` не трогаем — оно за discovery-агентом.
export async function moveDealStage(
  dealId: string,
  funnelStageId: string,
  note: string | null,
) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  await assertFunnelStageAccessible(funnelStageId, activeOrgId)

  const patch: Record<string, unknown> = {
    funnelStageId,
    updatedAt: new Date(),
  }
  const trimmed = note?.trim()
  if (trimmed) patch.changes = trimmed

  await db.update(deal).set(patch).where(eq(deal.id, dealId))
}
```

(`requireOrgContext`, `assertDealInOrg`, `assertFunnelStageAccessible`, `db`, `deal`, `eq` уже импортированы/определены в файле — используются в `updateDeal`.)

- [ ] **Step 2: Добавить ветку `move` в `PUT` (`src/app/api/deals/route.ts`)**

В импорт из `@/server/deals` (строки 2–11) добавить `moveDealStage`:

```ts
import {
  listDeals,
  listDealClientOptions,
  listDealContactOptions,
  listDealFunnelStages,
  createDeal,
  updateDeal,
  setDealStatus,
  moveDealStage,
  getDeal,
} from "@/server/deals"
```

В `PUT`, сразу после проверки `if (!id) {...}` (после строки 126) и ДО блока `if (statusOnly)`, вставить:

```ts
    // Перевод стадии из канбана: ставит funnelStageId + заметку-основание.
    if (body.move) {
      if (!funnelStageId) {
        return NextResponse.json(
          { error: "funnelStageId is required" },
          { status: 400 },
        )
      }
      await moveDealStage(id, funnelStageId, body.note ?? null)
      return NextResponse.json({ success: true })
    }
```

- [ ] **Step 3: Проверить типы**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка эндпоинта**

При запущенном dev-сервере (нужна активная сессия в браузере) — перевод проверим из UI на Task 8. Здесь достаточно typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/server/deals.ts src/app/api/deals/route.ts
git commit -m "feat(api): ручной перевод стадии сделки (moveDealStage)"
```

---

## Task 4: Поповер происхождения (DealProvenance)

**Files:** Create `src/components/blocks/deal-provenance.tsx`

- [ ] **Step 1: Создать компонент**

```tsx
"use client"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Sparkles } from "lucide-react"
import type { DealRow } from "@/app/api/deals/route"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Показывает происхождение последнего изменения сделки (reasoning/changes),
// если оно есть. Иначе ничего не рендерит.
export function DealProvenance({ deal }: { deal: DealRow }) {
  if (!deal.reasoning && !deal.changes) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Происхождение изменения"
        >
          <Badge
            variant="secondary"
            className="cursor-pointer bg-violet-500/15 text-violet-600 dark:text-violet-300 gap-1"
          >
            <Sparkles className="h-3 w-3" />
            происхождение
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Происхождение
        </div>
        {deal.changes && (
          <div>
            <div className="text-xs text-muted-foreground">Изменение</div>
            <div className="whitespace-pre-wrap">{deal.changes}</div>
          </div>
        )}
        {deal.reasoning && (
          <div>
            <div className="text-xs text-muted-foreground">Обоснование</div>
            <div className="whitespace-pre-wrap">{deal.reasoning}</div>
          </div>
        )}
        <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t">
          <span>{deal.userName ?? "—"}</span>
          <span>{formatDate(deal.updatedAt)}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Проверить типы**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/components/blocks/deal-provenance.tsx
git commit -m "feat: поповер происхождения сделки"
```

---

## Task 5: Draggable-карточка (DealKanbanCard)

**Files:** Create `src/components/blocks/deal-kanban-card.tsx`

- [ ] **Step 1: Создать компонент**

```tsx
"use client"

import { useDraggable } from "@dnd-kit/core"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Building2, User, Pencil } from "lucide-react"
import type { DealRow, DealFunnelStageOption } from "@/app/api/deals/route"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DealProvenance } from "@/components/blocks/deal-provenance"
import { formatAmount } from "@/lib/deal-board"

export function DealKanbanCard({
  deal,
  stages,
  onChanged,
}: {
  deal: DealRow
  stages: DealFunnelStageOption[]
  onChanged: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  })
  const amount = formatAmount(deal.value, deal.currency)

  return (
    <Card
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`p-3 space-y-2 bg-card cursor-grab active:cursor-grabbing border-muted ${
        isDragging ? "opacity-40" : ""
      }`}
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

      <div className="flex flex-wrap gap-1">
        <DealProvenance deal={deal} />
      </div>
    </Card>
  )
}
```

Примечание: `onPointerDown={(e) => e.stopPropagation()}` на интерактивных детях (кнопка ред., триггер поповера) не даёт dnd-kit перехватить клик; плюс сенсор в доске активируется только после сдвига на 5px (Task 7).

- [ ] **Step 2: Проверить типы**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/components/blocks/deal-kanban-card.tsx
git commit -m "feat: draggable-карточка сделки для канбана"
```

---

## Task 6: Диалог подтверждения перевода (DealMoveDialog)

**Files:** Create `src/components/blocks/deal-move-dialog.tsx`

- [ ] **Step 1: Создать компонент**

```tsx
"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { MoveDirection } from "@/lib/deal-board"

export type PendingMove = {
  dealId: string
  dealName: string
  toStageId: string
  fromLabel: string
  toLabel: string
  direction: MoveDirection
}

export function DealMoveDialog({
  move,
  pending,
  onConfirm,
  onCancel,
}: {
  move: PendingMove | null
  pending: boolean
  onConfirm: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState("")
  const isBack = move?.direction === "back"
  const canConfirm = !isBack || note.trim().length >= 3

  return (
    <Dialog
      open={move !== null}
      onOpenChange={(open) => {
        if (!open) {
          setNote("")
          onCancel()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {move
              ? isBack
                ? `Возврат: ${move.dealName}`
                : `${move.dealName} → ${move.toLabel}`
              : ""}
          </DialogTitle>
          <DialogDescription>
            {isBack
              ? `Обратный перевод ${move?.fromLabel} → ${move?.toLabel}. Укажите основание (обязательно).`
              : `Перевод ${move?.fromLabel} → ${move?.toLabel}. Комментарий по желанию.`}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            isBack
              ? "Что произошло? Например: «КП недействительно, клиент сменил юрлицо»"
              : "Комментарий (необязательно): источник, контекст…"
          }
          className="min-h-24"
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setNote("")
              onCancel()
            }}
            disabled={pending}
          >
            Отмена
          </Button>
          <Button
            onClick={() => onConfirm(note)}
            disabled={!canConfirm || pending}
          >
            {pending ? "Перевод…" : isBack ? "Перевести назад" : "Перевести"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Проверить типы**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/components/blocks/deal-move-dialog.tsx
git commit -m "feat: диалог подтверждения перевода стадии"
```

---

## Task 7: Доска (DealsBoard)

**Files:** Create `src/components/blocks/deals-board.tsx`

- [ ] **Step 1: Создать компонент**

```tsx
"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { DealRow, DealFunnelStageOption } from "@/app/api/deals/route"
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
import { DealKanbanCard } from "@/components/blocks/deal-kanban-card"
import {
  DealMoveDialog,
  type PendingMove,
} from "@/components/blocks/deal-move-dialog"

function Column({
  stage,
  deals,
  stages,
  onChanged,
}: {
  stage: DealFunnelStageOption
  deals: DealRow[]
  stages: DealFunnelStageOption[]
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
          <DealKanbanCard
            key={d.id}
            deal={d}
            stages={stages}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  )
}

export function DealsBoard({
  deals,
  stages,
  currentUserId,
}: {
  deals: DealRow[]
  stages: DealFunnelStageOption[]
  currentUserId: string
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<OwnerFilter>("all")
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [isPending, startTransition] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const visible = useMemo(
    () => filterByOwner(deals, filter, currentUserId),
    [deals, filter, currentUserId],
  )

  const activeDeals = useMemo(
    () => visible.filter((d) => d.status === "active"),
    [visible],
  )

  const flowStages = stages.filter((s) => !isTerminalStage(s.name))
  const terminalStages = stages.filter((s) => isTerminalStage(s.name))

  const forecast = useMemo(
    () => weightedForecast(visible, stages),
    [visible, stages],
  )
  const openCount = activeDeals.filter(
    (d) => !isTerminalStage(d.funnelStageName),
  ).length

  const dealsByStage = (stageId: string) =>
    activeDeals.filter((d) => d.funnelStageId === stageId)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const deal = deals.find((d) => d.id === active.id)
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
      <div className="flex items-center gap-4 p-4 flex-wrap">
        <h1 className="text-lg font-semibold uppercase tracking-wide">
          Сделки
        </h1>
        <span className="text-sm text-muted-foreground">
          взвешенный прогноз{" "}
          <b className="text-foreground">{formatAggregate(forecast)}</b> ·
          открытых: <b className="text-foreground">{openCount}</b>
        </span>
        <div className="ml-auto flex rounded-lg border overflow-hidden">
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
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex-1 min-h-0 flex gap-2 overflow-x-auto px-4 pb-4 items-start">
          {flowStages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              deals={dealsByStage(stage.id)}
              stages={stages}
              onChanged={() => router.refresh()}
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

- [ ] **Step 2: Проверить типы**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/components/blocks/deals-board.tsx
git commit -m "feat: канбан-доска сделок (DndContext, прогноз, фильтр)"
```

---

## Task 8: Страница /deals (RSC) + проверка drag&drop

**Files:** Create `src/app/(protected)/deals/page.tsx`

- [ ] **Step 1: Создать страницу**

```tsx
import { listDeals, listDealFunnelStages } from "@/server/deals"
import { getServerSession } from "@/lib/get-session"
import { DealsBoard } from "@/components/blocks/deals-board"

export default async function DealsPage() {
  const [deals, stages, session] = await Promise.all([
    listDeals({ includeCancelled: false, includeDeleted: false }),
    listDealFunnelStages(),
    getServerSession(),
  ])
  const currentUserId = session?.user.id ?? ""

  return (
    <div className="h-[calc(100vh-1rem)]">
      <DealsBoard
        deals={deals}
        stages={stages}
        currentUserId={currentUserId}
      />
    </div>
  )
}
```

Примечание: если `listDeals` принимает аргумент без полей по умолчанию — передаём оба флага явно (как делает `GET /api/deals`). Если `getServerSession` требует иной путь импорта — свериться с `app-sidebar.tsx` (там `import type { getServerSession } from "@/lib/get-session"`).

- [ ] **Step 2: Проверить типы**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Запустить dev и проверить страницу**

Run: `corepack pnpm dev` (если не запущен), открыть `http://localhost:3000/deals`.
Expected:
- Колонки соответствуют стадиям воронки; терминальные (Закрыта/Проиграна) — в полке «Итоги» справа.
- В шапке виден взвешенный прогноз и число открытых.
- Переключатель «Все/Мои» меняет набор карточек.

- [ ] **Step 4: Проверить drag&drop и перевод**

- Перетащить карточку в соседнюю колонку → открывается диалог «X → Y», комментарий опционален → «Перевести» → карточка переехала, toast, provenance обновился.
- Перетащить назад (в колонку левее) → кнопка заблокирована, пока не введена причина (≥3 симв.).
- Перетащить в полку «Итоги» → toast «терминальные стадии защищены», перевода нет.
- Клик по карандашу открывает редактирование (drag не срабатывает).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(protected)/deals/page.tsx"
git commit -m "feat: страница /deals с канбан-доской сделок"
```

---

## Task 9: Пункт «Сделки» в сайдбаре

**Files:** Modify `src/components/blocks/app-sidebar.tsx`

- [ ] **Step 1: Добавить иконку в импорт lucide**

В блоке импорта иконок (строки 3–13) добавить `SquareKanban`:

```ts
import {
  Home,
  FileText,
  ShieldCheck,
  CircleUserRound,
  PencilRuler,
  Database,
  Users,
  ListChecks,
  Package,
  SquareKanban,
} from "lucide-react"
```

(Если `SquareKanban` отсутствует в установленной версии lucide — использовать `Workflow`.)

- [ ] **Step 2: Добавить пункт меню после «Клиенты»**

В массив `items` (строки 41–72), сразу после объекта «Клиенты» (`url: "/clients"`), вставить:

```ts
  {
    title: "Сделки",
    url: "/deals",
    icon: SquareKanban,
  },
```

- [ ] **Step 3: Проверить типы**

Run: `corepack pnpm exec tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка**

Открыть приложение: в сайдбаре есть пункт «Сделки» после «Клиенты», ведёт на `/deals`, активное состояние подсвечивается на этой странице.

- [ ] **Step 5: Commit**

```bash
git add src/components/blocks/app-sidebar.tsx
git commit -m "feat: пункт «Сделки» в навигации"
```

---

## Task 10: Финальная проверка

- [ ] **Step 1: Полная сборка**

Run: `corepack pnpm build`
Expected: сборка проходит без ошибок типов/линта.

- [ ] **Step 2: Smoke-проход по UI**

При `corepack pnpm dev`:
- `/deals` рендерится, drag&drop и диалоги работают (см. Task 8, Step 4).
- `/clients` — карточки сделок не сломаны (Task 2).
- Светлая/тёмная тема (ModeSwitcher) — доска читается в обеих.

- [ ] **Step 3: Финальный commit (если остались несведённые изменения)**

```bash
git add -A
git commit -m "chore: финализация канбана сделок (итерация 1)"
```

---

## Self-review заметки

- **Покрытие спеки:** доска/колонки/прогноз/фильтр (Task 7,8), drag&drop (Task 1,7,8), provenance (Task 4,5), лёгкое подтверждение перевода (Task 6,7), бэкенд-заметка перевода (Task 3), терминальная полка (Task 7), сайдбар (Task 9), тема (Task 10). Отложенное из спеки (агент, лента, чеклисты, остывание, инвариант) — не входит, по решению.
- **Типы:** `DealRow`/`DealFunnelStageOption` из `@/app/api/deals/route` (реэкспорт из `@/server/deals`); `PendingMove`/`MoveDirection`/`OwnerFilter` определены в Task 6/Task 2 и используются согласованно в Task 7.
- **Без тест-раннера:** проверка через `tsc --noEmit`, `lint`, `build` и ручные сценарии — по решению заказчика.
