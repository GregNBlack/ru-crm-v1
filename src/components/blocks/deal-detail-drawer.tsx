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
              <div className="text-muted-foreground">Нет задач по сделке.</div>
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
