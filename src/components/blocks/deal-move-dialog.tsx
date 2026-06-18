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
