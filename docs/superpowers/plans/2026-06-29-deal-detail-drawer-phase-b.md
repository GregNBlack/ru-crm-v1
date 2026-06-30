# Детальная вьюха сделки — Фаза B (контакты с ролями) — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Во вкладке «Контакты» drawer'а показывать контакты сделки с их ролями (ЛПР/чемпион/блокировщик/…), добавлять/убирать контакты и назначать роли.

**Architecture:** Новый enum + nullable-колонка `role` на `deal_contact`; серверные функции в `@/server/deals`; новый роут `/api/deals/[id]/contacts` (GET+PUT); UI-компонент вкладки + подключение в drawer.

**Tech Stack:** Drizzle (PostgreSQL/Neon), Next.js 16 / React 19, shadcn `Select`/`Button`.

**Verification:** тест-раннера нет — `corepack pnpm exec tsc --noEmit` + `corepack pnpm lint` + `corepack pnpm build` + ручные сценарии.

**⚠️ Миграция БД:** Task 1 меняет схему. Применение (`corepack pnpm drizzle-kit push`) — **отдельный шаг, выполняется контроллером после подтверждения пользователя**, НЕ субагентом. Изменение аддитивное (новый enum + nullable-колонка), существующие строки получают `role = NULL`.

**Подтверждённые факты:** `deal_contact` сейчас `{ dealId, contactId }` (PK), без role. `contact` имеет `name, nameNative, position, email`. Хелперы `requireOrgContext`, `assertDealInOrg`, `assertContactsInOrg` есть в `server/deals.ts`. `listDealContactOptions(clientId?)` → `DealContactOption {id, name, clientId}`. `getDeal(id)` → `DealRow | null` (есть `clientId`). drizzle: schema `./src/db/schema.ts`, dialect postgresql.

---

## File Structure
- Modify `src/db/schema.ts` — enum `dealContactRole` + колонка `role` на `dealContact`.
- Create `src/lib/deal-roles.ts` — RU-ярлыки и порядок ролей.
- Modify `src/server/deals.ts` — `listDealContactsWithRoles`, `addDealContact`, `setDealContactRole`, `removeDealContact`, тип `DealContactWithRole`.
- Create `src/app/api/deals/[id]/contacts/route.ts` — GET (контакты+роли+опции) и PUT (add/setRole/remove).
- Create `src/components/blocks/deal-contacts-roles.tsx` — содержимое вкладки.
- Modify `src/components/blocks/deal-detail-drawer.tsx` — вкладка «Контакты».

---

## Task 1: Схема — enum роли + колонка role

**Files:** Modify `src/db/schema.ts`

- [ ] **Step 1: Добавить enum** рядом с другими `pgEnum` (например, после `dealStatus`):
```ts
export const dealContactRole = pgEnum("deal_contact_role", [
  "decision_maker",
  "influencer",
  "expert",
  "initiator",
  "economic_buyer",
  "champion",
  "blocker",
  "user",
  "gatekeeper",
])
export type DealContactRole = (typeof dealContactRole.enumValues)[number]
```

- [ ] **Step 2: Добавить колонку `role`** в таблицу `dealContact` (после `contactId`, до `(table) => [...]`):
```ts
    role: dealContactRole("role"),
```
(nullable — у существующих связей роли нет.)

- [ ] **Step 3:** `corepack pnpm exec tsc --noEmit` → без ошибок.

- [ ] **Step 4: Commit (только код схемы; миграцию НЕ запускать):**
```
git add src/db/schema.ts
git commit -m "feat(db): роль контакта в сделке (enum deal_contact_role + колонка role)"
```

- [ ] **Step 5: МИГРАЦИЯ — выполняет контроллер после подтверждения пользователя.**
Команда: `corepack pnpm drizzle-kit push` (создаёт тип `deal_contact_role` и добавляет колонку `role` в `deal_contact`). НЕ запускать в рамках субагента.

---

## Task 2: RU-ярлыки ролей

**Files:** Create `src/lib/deal-roles.ts`

- [ ] **Step 1: Создать файл:**
```ts
import type { DealContactRole } from "@/db/schema"

// Порядок отображения ролей в селекте.
export const DEAL_CONTACT_ROLES: DealContactRole[] = [
  "decision_maker",
  "influencer",
  "expert",
  "initiator",
  "economic_buyer",
  "champion",
  "blocker",
  "user",
  "gatekeeper",
]

export const DEAL_CONTACT_ROLE_LABEL: Record<DealContactRole, string> = {
  decision_maker: "ЛПР",
  influencer: "ЛВПР",
  expert: "Эксперт",
  initiator: "Инициатор",
  economic_buyer: "Экономический покупатель",
  champion: "Чемпион",
  blocker: "Блокировщик",
  user: "Пользователь",
  gatekeeper: "Секретарь",
}

export function dealContactRoleLabel(role: string | null): string {
  if (!role) return "Без роли"
  return DEAL_CONTACT_ROLE_LABEL[role as DealContactRole] ?? role
}
```

- [ ] **Step 2:** `corepack pnpm exec tsc --noEmit` → без ошибок.
- [ ] **Step 3: Commit**
```
git add src/lib/deal-roles.ts
git commit -m "feat: RU-ярлыки ролей контактов сделки"
```

---

## Task 3: Серверные функции

**Files:** Modify `src/server/deals.ts`

- [ ] **Step 1: Добавить импорт типа enum** в существующий импорт из `@/db/schema` (там уже импортируются таблицы `deal`, `dealContact`, `contact` и enum `dealStatus`). Добавить `dealContactRole` и тип `DealContactRole`:
```ts
import { ..., dealContactRole, type DealContactRole } from "@/db/schema"
```
(Если импорт схемы разбит — добавить в соответствующие группы; `dealContact` и `contact` уже импортированы.)

- [ ] **Step 2: Добавить тип и функции** (в конец файла):
```ts
export type DealContactWithRole = {
  id: string
  name: string
  nameNative: string | null
  position: string | null
  email: string | null
  role: DealContactRole | null
}

export async function listDealContactsWithRoles(
  dealId: string,
): Promise<DealContactWithRole[]> {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  const rows = await db
    .select({
      id: contact.id,
      name: contact.name,
      nameNative: contact.nameNative,
      position: contact.position,
      email: contact.email,
      role: dealContact.role,
    })
    .from(dealContact)
    .innerJoin(contact, eq(dealContact.contactId, contact.id))
    .where(eq(dealContact.dealId, dealId))
  return rows
}

export async function addDealContact(dealId: string, contactId: string) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  await assertContactsInOrg([contactId], activeOrgId)
  await db
    .insert(dealContact)
    .values({ dealId, contactId })
    .onConflictDoNothing()
}

export async function setDealContactRole(
  dealId: string,
  contactId: string,
  role: DealContactRole | null,
) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  if (role !== null && !dealContactRole.enumValues.includes(role)) {
    throw new Error("Invalid contact role")
  }
  await db
    .update(dealContact)
    .set({ role })
    .where(
      and(
        eq(dealContact.dealId, dealId),
        eq(dealContact.contactId, contactId),
      ),
    )
}

export async function removeDealContact(dealId: string, contactId: string) {
  const { activeOrgId } = await requireOrgContext()
  await assertDealInOrg(dealId, activeOrgId)
  await db
    .delete(dealContact)
    .where(
      and(
        eq(dealContact.dealId, dealId),
        eq(dealContact.contactId, contactId),
      ),
    )
}
```
(`eq`, `and`, `db`, `contact`, `dealContact`, `assertContactsInOrg`, `requireOrgContext`, `assertDealInOrg` уже доступны в файле — `and` используется в `setDealStatus`/`updateDeal`; если `and` не импортирован, добавить в импорт из `drizzle-orm`.)

- [ ] **Step 3:** `corepack pnpm exec tsc --noEmit` → без ошибок.
- [ ] **Step 4: Commit**
```
git add src/server/deals.ts
git commit -m "feat(server): контакты сделки с ролями (list/add/setRole/remove)"
```

---

## Task 4: API-роут /api/deals/[id]/contacts

**Files:** Create `src/app/api/deals/[id]/contacts/route.ts`

- [ ] **Step 1: Создать файл:**
```ts
import { NextRequest, NextResponse } from "next/server"
import {
  getDeal,
  listDealContactsWithRoles,
  listDealContactOptions,
  addDealContact,
  setDealContactRole,
  removeDealContact,
} from "@/server/deals"
import { dealContactRole } from "@/db/schema"

export { type DealContactWithRole } from "@/server/deals"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message === "Deal not found"
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const deal = await getDeal(id)
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 })
    }
    const [contacts, options] = await Promise.all([
      listDealContactsWithRoles(id),
      listDealContactOptions(deal.clientId),
    ])
    const linkedIds = new Set(contacts.map((c) => c.id))
    return NextResponse.json({
      contacts,
      // Кандидаты на добавление — контакты клиента, ещё не привязанные к сделке.
      options: options.filter((o) => !linkedIds.has(o.id)),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { action, contactId, role } = body
    if (!contactId) {
      return NextResponse.json(
        { error: "contactId is required" },
        { status: 400 },
      )
    }
    if (action === "add") {
      await addDealContact(id, contactId)
    } else if (action === "remove") {
      await removeDealContact(id, contactId)
    } else if (action === "setRole") {
      const valid =
        role === null || dealContactRole.enumValues.includes(role)
      if (!valid) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 })
      }
      await setDealContactRole(id, contactId, role ?? null)
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}
```

- [ ] **Step 2: Проверить** сигнатуру динамических роутов в проекте: в Next 16 `params` — это `Promise`. Свериться с существующим динамическим роутом (например, `src/app/api/sources/items/[id]/...`); если там `params` НЕ Promise (а объект), привести к тому же стилю. Адаптировать и сообщить.
- [ ] **Step 3:** `corepack pnpm exec tsc --noEmit` → без ошибок.
- [ ] **Step 4: Commit**
```
git add "src/app/api/deals/[id]/contacts/route.ts"
git commit -m "feat(api): /api/deals/[id]/contacts (роли контактов сделки)"
```

---

## Task 5: UI-вкладка «Контакты» + подключение в drawer

**Files:**
- Create `src/components/blocks/deal-contacts-roles.tsx`
- Modify `src/components/blocks/deal-detail-drawer.tsx`

- [ ] **Step 1: Создать `src/components/blocks/deal-contacts-roles.tsx`:**
```tsx
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
import { Plus, X } from "lucide-react"
import { toast } from "sonner"
import type { DealContactWithRole } from "@/app/api/deals/[id]/contacts/route"
import type { DealContactOption } from "@/app/api/deals/route"
import { DEAL_CONTACT_ROLES, dealContactRoleLabel } from "@/lib/deal-roles"

const NO_ROLE = "__none__"

export function DealContactsRoles({ dealId }: { dealId: string }) {
  const [contacts, setContacts] = useState<DealContactWithRole[]>([])
  const [options, setOptions] = useState<DealContactOption[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}/contacts`)
    const data = await res.json()
    setContacts(data.contacts ?? [])
    setOptions(data.options ?? [])
    setLoading(false)
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
              className="h-8 w-8"
              aria-label="Убрать контакт"
              onClick={() =>
                mutate(
                  { action: "remove", contactId: c.id },
                  "Контакт убран",
                )
              }
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      {options.length > 0 && (
        <div className="pt-1">
          <Select
            open={adding}
            onOpenChange={setAdding}
            value=""
            onValueChange={(contactId) =>
              mutate({ action: "add", contactId }, "Контакт добавлен")
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Plus className="h-4 w-4" />
                Добавить контакт
              </span>
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Проверить, что `SelectTrigger` принимает `size="sm"`** (использовалось в проекте ранее — да). Если нет — убрать `size`.

- [ ] **Step 3: Подключить вкладку в `deal-detail-drawer.tsx`:**
  - Импорт: `import { DealContactsRoles } from "@/components/blocks/deal-contacts-roles"`.
  - В `<TabsList>` добавить триггер ПОСЛЕ «Сводка» (до «Задачи» или после — на ваш вкус, поставить после «Сводка»):
    ```tsx
    <TabsTrigger value="contacts">Контакты</TabsTrigger>
    ```
  - Добавить контент:
    ```tsx
    <TabsContent
      value="contacts"
      className="flex-1 min-h-0 overflow-y-auto p-4 text-sm"
    >
      <DealContactsRoles dealId={deal.id} />
    </TabsContent>
    ```

- [ ] **Step 4:** `corepack pnpm exec tsc --noEmit` → без ошибок; `corepack pnpm build` → EXIT 0.

- [ ] **Step 5: Ручная проверка** (после миграции; `/deals`, drawer → вкладка «Контакты»): список контактов сделки с ролями; смена роли через select сохраняется; «Добавить контакт» добавляет из контактов клиента; крестик убирает; пустые состояния.

- [ ] **Step 6: Commit**
```
git add src/components/blocks/deal-contacts-roles.tsx src/components/blocks/deal-detail-drawer.tsx
git commit -m "feat: вкладка «Контакты» с ролями в drawer сделки"
```

---

## Self-review
- **Покрытие:** enum+колонка (Task 1), ярлыки (Task 2), server CRUD (Task 3), API (Task 4), UI+wire (Task 5). Соответствует разделу спеки «Контакты с ролями».
- **Миграция БД** изолирована в Task 1 Step 5, выполняется контроллером после подтверждения.
- **Типы:** `DealContactRole` из схемы; `DealContactWithRole` из server, реэкспорт из route; `DealContactOption` из `@/app/api/deals/route`.
- **Доступ:** все серверные функции через `requireOrgContext` + `assertDealInOrg` (+`assertContactsInOrg` для add) — консистентно с существующими.
- **Без тест-раннера:** tsc/lint/build + ручные сценарии.
