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
import {
  DealKanbanCard,
  DealKanbanCardOverlay,
} from "@/components/blocks/deal-kanban-card"
import {
  DealMoveDialog,
  type PendingMove,
} from "@/components/blocks/deal-move-dialog"

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
}: {
  deals: DealRow[]
  stages: DealFunnelStageOption[]
  currentUserId: string
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<OwnerFilter>("all")
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
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
      <div className="flex flex-col gap-2 p-4">
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
        <div className="flex w-fit rounded-lg border overflow-hidden">
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
