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
