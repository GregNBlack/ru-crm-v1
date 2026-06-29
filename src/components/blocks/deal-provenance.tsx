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
          onClick={(e) => e.stopPropagation()}
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
