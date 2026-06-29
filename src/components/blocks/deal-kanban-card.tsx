"use client"

import { useDraggable } from "@dnd-kit/core"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pencil } from "lucide-react"
import type { DealRow } from "@/app/api/deals/route"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DealProvenance } from "@/components/blocks/deal-provenance"
import { formatAmount } from "@/lib/deal-board"

// Заголовок: компания (клиент) сверху, продукт/проект (название сделки) — строкой
// ниже. Если клиент не привязан, название сделки само становится заголовком.
function DealTitle({ deal }: { deal: DealRow }) {
  const company = deal.clientName ?? deal.name
  const product = deal.clientName ? deal.name : null
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium leading-snug truncate">{company}</div>
      {product && (
        <div className="text-xs text-muted-foreground leading-snug truncate">
          {product}
        </div>
      )}
    </div>
  )
}

// Сумма · ответственный — одной строкой.
function DealMetaLine({ deal }: { deal: DealRow }) {
  const amount = formatAmount(deal.value, deal.currency)
  if (!amount && !deal.userName) return null
  return (
    <div className="text-sm">
      {amount && <span className="font-semibold">{amount}</span>}
      {amount && deal.userName && (
        <span className="text-muted-foreground"> · </span>
      )}
      {deal.userName && (
        <span className="text-muted-foreground">{deal.userName}</span>
      )}
    </div>
  )
}

export function DealKanbanCard({
  deal,
  onChanged,
  onOpen,
}: {
  deal: DealRow
  onChanged: () => void
  onOpen: (deal: DealRow) => void
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
      onClick={() => onOpen(deal)}
    >
      <div className="flex items-start justify-between gap-2">
        <DealTitle deal={deal} />
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
              onClick={(e) => e.stopPropagation()}
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

      <DealMetaLine deal={deal} />

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
      <DealTitle deal={deal} />
      <DealMetaLine deal={deal} />
    </Card>
  )
}
