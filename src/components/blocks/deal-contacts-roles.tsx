"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import { toast } from "sonner"
import type { DealContactWithRole } from "@/app/api/deals/[id]/contacts/route"
import type { DealContactOption } from "@/app/api/deals/route"
import { DEAL_CONTACT_ROLES, dealContactRoleLabel } from "@/lib/deal-roles"

const NO_ROLE = "__none__"

export function DealContactsRoles({ dealId }: { dealId: string }) {
  const [contacts, setContacts] = useState<DealContactWithRole[]>([])
  const [options, setOptions] = useState<DealContactOption[]>([])
  const [loading, setLoading] = useState(true)
  // Меняем key после добавления — пересоздаём Select, чтобы он сбросился
  // (неконтролируемый, без value="" — иначе onValueChange не срабатывает).
  const [addKey, setAddKey] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/contacts`)
      const data = await res.json()
      setContacts(data.contacts ?? [])
      setOptions(data.options ?? [])
    } catch {
      toast.error("Не удалось загрузить контакты")
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  async function mutate(body: object, okMsg: string) {
    const res = await fetch(`/api/deals/${dealId}/contacts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error || "Не удалось обновить контакты")
      return
    }
    toast.success(okMsg)
    await load()
  }

  if (loading) {
    return <div className="text-muted-foreground text-sm">Загрузка…</div>
  }

  return (
    <div className="space-y-3">
      {contacts.length === 0 && (
        <div className="text-muted-foreground text-sm">
          К сделке не привязаны контакты.
        </div>
      )}

      {contacts.map((c) => (
        <div
          key={c.id}
          className="rounded-md border p-2.5 flex items-center justify-between gap-2"
        >
          <div className="min-w-0">
            <div className="font-medium leading-snug truncate">
              {c.nameNative ?? c.name}
            </div>
            {c.position && (
              <div className="text-xs text-muted-foreground truncate">
                {c.position}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Select
              value={c.role ?? NO_ROLE}
              onValueChange={(v) =>
                mutate(
                  {
                    action: "setRole",
                    contactId: c.id,
                    role: v === NO_ROLE ? null : v,
                  },
                  "Роль обновлена",
                )
              }
            >
              <SelectTrigger size="sm" className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ROLE}>Без роли</SelectItem>
                {DEAL_CONTACT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {dealContactRoleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              aria-label="Убрать контакт из сделки"
              title="Убрать из сделки"
              onClick={() =>
                mutate({ action: "remove", contactId: c.id }, "Контакт убран")
              }
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <div className="pt-1">
        {options.length > 0 ? (
          <Select
            key={addKey}
            onValueChange={(contactId) => {
              setAddKey((k) => k + 1)
              mutate({ action: "add", contactId }, "Контакт добавлен")
            }}
          >
            <SelectTrigger size="sm" className="w-full text-muted-foreground">
              <SelectValue placeholder="+ Добавить контакт" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-xs text-muted-foreground">
            Нет других контактов клиента для добавления.
          </div>
        )}
      </div>
    </div>
  )
}
