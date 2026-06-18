"use client"

import { useDraggable } from "@dnd-kit/core"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Building2, User, Pencil } from "lucide-react"
import type { DealRow } from "@/app/api/deals/route"
import DealEditDialog from "@/components/forms/form-deal-edit"
import { DealProvenance } from "@/components/blocks/deal-provenance"
import { formatAmount } from "@/lib/deal-board"

// Сумма + клиент + владелец — общий блок для интерактивной карточки и для
// превью в DragOverlay (чтобы превью визуально совпадало с реальной карточкой).
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  })

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

      <CardMeta deal={deal} />

      <div className="flex flex-wrap gap-1">
        <DealProvenance deal={deal} />
      </div>
    </Card>
  )
}

// Превью карточки, следующее за курсором во время перетаскивания (DragOverlay).
// Без интерактивных элементов; приподнято тенью и лёгким наклоном, чтобы было
// видно, что «плашка» физически перетаскивается.
export function DealKanbanCardOverlay({ deal }: { deal: DealRow }) {
  return (
    <Card className="w-64 p-3 space-y-2 bg-card border-muted shadow-xl rotate-2 cursor-grabbing">
      <div className="text-sm font-medium leading-snug">{deal.name}</div>
      <CardMeta deal={deal} />
    </Card>
  )
}
