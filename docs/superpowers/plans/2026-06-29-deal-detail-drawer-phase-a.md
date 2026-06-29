# Детальная вьюха сделки — Фаза A (drawer-каркас) — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Клик по карточке в `/deals` открывает боковую панель (drawer) с детальной сделкой: сводка, перевод стадии, редактирование, задачи.

**Architecture:** Чисто фронтенд — новых таблиц/роутов нет. Drawer получает уже загруженную `DealRow` пропсом (сводка без доп. запроса), стадию двигает существующим `PUT /api/deals {move:true}`, задачи берёт из существующего `GET /api/tasks` (фильтр по `dealId` на клиенте), редактирование — существующий `DealEditDialog`.

**Tech Stack:** Next.js 16 / React 19, shadcn `Sheet`/`Tabs`/`Select`/`Badge`, sonner.

**Verification:** тест-раннера нет — `corepack pnpm exec tsc --noEmit` + `corepack pnpm lint` + `corepack pnpm build` + ручная проверка на `/deals`.

**Подтверждённые факты:** `Sheet*` экспортируются из `@/components/ui/sheet`; `GET /api/tasks` (без параметров) → `{ tasks: TaskRow[] }`; `TaskRow = { id, name, status, dealId: string|null, dueDate: string(ISO), ... }`; `DealRow`/`DealFunnelStageOption` из `@/app/api/deals/route`; хелперы `STAGE_COLOR/STAGE_DEFAULT/formatAmount` в `@/lib/deal-board`; `dealStageLabel` в `@/lib/deal-funnel`; `DealEditDialog` — default export `@/components/forms/form-deal-edit` (props `mode/deal/trigger/onSuccess`).

---

## File Structure
- Create `src/components/blocks/deal-detail-drawer.tsx` — Sheet-обёртка: шапка, перевод стадии, редактирование, вкладки Сводка/Задачи.
- Modify `src/components/blocks/deal-kanban-card.tsx` — клик по карточке вызывает `onOpen(deal)`; edit/provenance гасят click.
- Modify `src/components/blocks/deals-board.tsx` — состояние выбранной сделки + рендер drawer.

---

## Task 1: Компонент DealDetailDrawer

**Files:** Create `src/components/blocks/deal-detail-drawer.tsx`

- [ ] **Step 1: Создать файл с содержимым:**

```tsx
"use client"

import { useEffect, useState, useTransition } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pencil } from "lucide-react"
import { toast } from "sonner"
import type { DealRow, DealFunnelStageOption } from "@/app/api/deals/route"
import type { TaskRow } from "@/app/api/tasks/route"
import { dealStageLabel } from "@/lib/deal-funnel"
import { STAGE_COLOR, STAGE_DEFAULT, formatAmount } from "@/lib/deal-board"
import DealEditDialog from "@/components/forms/form-deal-edit"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function DealDetailDrawer({
  deal,
  stages,
  open,
  onOpenChange,
  onChanged,
}: {
  deal: DealRow | null
  stages: DealFunnelStageOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  // Локальная стадия — чтобы шапка/селект обновлялись сразу после перевода,
  // не дожидаясь обновления пропа из доски.
  const [stageId, setStageId] = useState<string>(deal?.funnelStageId ?? "")
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setStageId(deal?.funnelStageId ?? "")
  }, [deal?.id, deal?.funnelStageId])

  // Задачи сделки: тянем все и фильтруем по dealId (отдельного эндпоинта нет).
  useEffect(() => {
    if (!open || !deal) return
    let cancelled = false
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data: { tasks?: TaskRow[] }) => {
        if (cancelled) return
        const all = data.tasks ?? []
        setTasks(
          all
            .filter((t) => t.dealId === deal.id)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
        )
      })
      .catch(() => {
        if (!cancelled) setTasks([])
      })
    return () => {
      cancelled = true
    }
  }, [open, deal?.id, deal])

  if (!deal) return null

  const isActive = deal.status === "active"
  const company = deal.clientName ?? deal.name
  const product = deal.clientName ? deal.name : null
  const amount = formatAmount(deal.value, deal.currency)
  const currentStage = stages.find((s) => s.id === stageId)
  const stageClass = currentStage
    ? (STAGE_COLOR[currentStage.name] ?? STAGE_DEFAULT)
    : STAGE_DEFAULT

  function handleStageChange(nextStageId: string) {
    if (!deal || nextStageId === stageId) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/deals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: deal.id,
            move: true,
            funnelStageId: nextStageId,
            note: "",
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || "Не удалось перевести сделку")
          return
        }
        setStageId(nextStageId)
        const name = stages.find((s) => s.id === nextStageId)?.name
        toast.success(`Переведено: ${name ? dealStageLabel(name) : "этап"}`)
        onChanged()
      } catch {
        toast.error("Не удалось перевести сделку")
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="p-4 pb-3 border-b">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="truncate">{company}</SheetTitle>
              {product && (
                <div className="text-sm text-muted-foreground truncate">
                  {product}
                </div>
              )}
            </div>
            <DealEditDialog
              mode="edit"
              deal={deal}
              onSuccess={onChanged}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Редактировать
                </Button>
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="secondary" className={stageClass}>
              {currentStage ? dealStageLabel(currentStage.name) : "—"}
            </Badge>
            {amount && <span className="text-sm font-semibold">{amount}</span>}
            {deal.userName && (
              <span className="text-sm text-muted-foreground">
                · {deal.userName}
              </span>
            )}
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
          </div>

          <div className="pt-1">
            <Select
              value={stageId}
              onValueChange={handleStageChange}
              disabled={isPending || !isActive}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Перевести по воронке" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {dealStageLabel(s.name)} (
                    {Math.round(s.closureProbability * 100)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SheetHeader>

        <Tabs defaultValue="summary" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-4 mt-3 w-fit">
            <TabsTrigger value="summary">Сводка</TabsTrigger>
            <TabsTrigger value="tasks">
              Задачи
              {tasks.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({tasks.length})
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="summary"
            className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-sm"
          >
            {deal.description && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Описание
                </div>
                <p className="whitespace-pre-wrap">{deal.description}</p>
              </div>
            )}
            {deal.changes && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Изменение
                </div>
                <p className="whitespace-pre-wrap">{deal.changes}</p>
              </div>
            )}
            {deal.reasoning && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Обоснование
                </div>
                <p className="whitespace-pre-wrap">{deal.reasoning}</p>
              </div>
            )}
            <div className="text-xs text-muted-foreground pt-2 border-t">
              Создано {formatDate(deal.createdAt)} · обновлено{" "}
              {formatDate(deal.updatedAt)}
            </div>
          </TabsContent>

          <TabsContent
            value="tasks"
            className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 text-sm"
          >
            {tasks.length === 0 ? (
              <div className="text-muted-foreground">
                Нет задач по сделке.
              </div>
            ) : (
              tasks.map((t, i) => (
                <div
                  key={t.id}
                  className="rounded-md border p-2.5 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium leading-snug">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(t.dueDate)}
                      {i === 0 && (
                        <span className="ml-1.5 text-foreground">
                          · ближайший
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {t.status}
                  </Badge>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Проверить экспорты/типы.** Убедиться, что `TaskRow` экспортируется из `@/app/api/tasks/route` (если нет — импортировать из `@/server/tasks`, который его определяет, и при необходимости добавить реэкспорт в route, как сделано для `DealRow`). Убедиться, что `Sheet*`, `Tabs*`, `Select*` именованы как в импортах.
- [ ] **Step 3:** `corepack pnpm exec tsc --noEmit` → без ошибок.
- [ ] **Step 4:** Commit
```
git add src/components/blocks/deal-detail-drawer.tsx
git commit -m "feat: drawer детальной сделки (сводка, перевод стадии, задачи)"
```

---

## Task 2: Открытие drawer по клику на карточку

**Files:**
- Modify `src/components/blocks/deal-kanban-card.tsx`
- Modify `src/components/blocks/deals-board.tsx`

- [ ] **Step 1: В `deal-kanban-card.tsx` добавить проп `onOpen` и клик по карточке.**

Изменить сигнатуру `DealKanbanCard`:
```tsx
export function DealKanbanCard({
  deal,
  onChanged,
  onOpen,
}: {
  deal: DealRow
  onChanged: () => void
  onOpen: (deal: DealRow) => void
}) {
```
На корневом `<Card>` добавить обработчик клика (рядом с существующими `ref`/`{...attributes}`/`{...listeners}`):
```tsx
      onClick={() => onOpen(deal)}
```
(dnd-kit с `activationConstraint distance:5` не порождает click после реального перетаскивания, поэтому drag и click не конфликтуют.)

На кнопке-карандаше (триггер `DealEditDialog`) добавить гашение click рядом с существующим `onPointerDown`:
```tsx
              onClick={(e) => e.stopPropagation()}
```

- [ ] **Step 2: В `deal-provenance.tsx` погасить click на триггере поповера.**

В `src/components/blocks/deal-provenance.tsx` у `<button>`-триггера рядом с `onPointerDown` добавить:
```tsx
        onClick={(e) => e.stopPropagation()}
```
(чтобы клик по «происхождение» не открывал drawer).

- [ ] **Step 3: В `deals-board.tsx` подключить drawer.**

Добавить импорт:
```tsx
import { DealDetailDrawer } from "@/components/blocks/deal-detail-drawer"
```
В компоненте `DealsBoard` добавить состояние (рядом с другими `useState`):
```tsx
  const [openDeal, setOpenDeal] = useState<DealRow | null>(null)
```
Передавать `onOpen` в карточку. В `Column` проп пробросить: изменить сигнатуру `Column` (добавить `onOpen`) и в `<DealKanbanCard ... onOpen={onOpen} />`; в месте рендера `<Column ... onOpen={setOpenDeal} />`. Конкретно:
- В типе пропсов `Column` добавить `onOpen: (deal: DealRow) => void`, в деструктуризации — `onOpen`.
- В `Column` заменить `<DealKanbanCard key={d.id} deal={d} onChanged={onChanged} />` на `<DealKanbanCard key={d.id} deal={d} onChanged={onChanged} onOpen={onOpen} />`.
- В `DealsBoard` в рендере колонок заменить `<Column key={stage.id} stage={stage} deals={dealsByStage(stage.id)} onChanged={router.refresh} />` на тот же + `onOpen={setOpenDeal}`.

Перед закрывающим `</div>` корня (рядом с `<DealMoveDialog ... />`) добавить:
```tsx
      <DealDetailDrawer
        deal={openDeal}
        stages={stages}
        open={openDeal !== null}
        onOpenChange={(o) => {
          if (!o) setOpenDeal(null)
        }}
        onChanged={() => router.refresh()}
      />
```

- [ ] **Step 4:** `corepack pnpm exec tsc --noEmit` → без ошибок; `corepack pnpm build` → EXIT 0.

- [ ] **Step 5: Ручная проверка** (`/deals`, нужна сессия):
  - Клик по карточке открывает drawer справа со сводкой; перетаскивание по-прежнему работает; клик по карандашу открывает редактирование (drawer не открывается); клик по «происхождение» открывает поповер (drawer не открывается).
  - В drawer: перевод стадии через Select меняет стадию (toast), у неактивной сделки select заблокирован; вкладка «Задачи» показывает задачи сделки или «Нет задач».

- [ ] **Step 6: Commit**
```
git add src/components/blocks/deal-kanban-card.tsx src/components/blocks/deal-provenance.tsx src/components/blocks/deals-board.tsx
git commit -m "feat: открытие детального drawer по клику на карточку"
```

---

## Self-review
- **Покрытие фазы A:** drawer-каркас + сводка + перевод стадии + редактирование (Task 1), задачи (Task 1, вкладка), открытие по клику + сосуществование с drag (Task 2). Контакты-роли/документы/лента — фазы B/C/D, не здесь.
- **Типы:** `DealRow`/`DealFunnelStageOption`/`TaskRow` из route-реэкспортов; `onOpen: (deal: DealRow) => void` согласован между картой, колонкой и доской.
- **Без бэкенда:** новых таблиц/роутов нет; стадия — существующий `move`-PUT, задачи — существующий `GET /api/tasks`.
- **Без тест-раннера:** проверка tsc/lint/build + ручные сценарии.
