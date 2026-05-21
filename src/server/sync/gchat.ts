"use server"

import { getChatClient, listChatMembersDetailed } from "@/lib/google-chat"
import {
  upsertSourceItem,
  getLatestSourceCreatedAt,
} from "@/server/source-items"
import { getGchatCredentials } from "@/server/providers/credentials"
import { gchatProviderConfigSchema } from "@/server/providers/handlers"
import {
  CURSOR_OVERLAP_SECONDS,
  SYNC_PAGE_LIMIT,
  loadSource,
  stampLastSyncedAt,
  type SyncResult,
} from "./_shared"

export async function syncGoogleChatMessages(
  sourceId: string,
): Promise<SyncResult> {
  const ctx = await loadSource(sourceId)
  if (ctx.provider !== "gchat") {
    throw new Error(
      `Expected gchat provider, got ${ctx.provider} for source ${sourceId}`,
    )
  }

  const config = gchatProviderConfigSchema.parse(ctx.providerConfig)
  const creds = getGchatCredentials(ctx.id, ctx.credentialsRef)
  const chat = getChatClient(creds)

  // Fetch space members once so we can resolve each message's sender to a
  // contactable {email, name}. External / cross-tenant senders typically
  // have no email — they just won't appear in the map.
  const members = await listChatMembersDetailed(creds, config.spaceId)
  const senderByResource = new Map<string, { email: string; name: string }>()
  for (const m of members) {
    if (m.email) {
      senderByResource.set(m.resourceName, {
        email: m.email,
        name: m.displayName ?? "",
      })
    }
  }

  const cursor = await getLatestSourceCreatedAt(sourceId)
  // Chat's filter syntax wants RFC3339 with the `T…Z` suffix.
  const cursorIso = cursor
    ? new Date(cursor.getTime() - CURSOR_OVERLAP_SECONDS * 1000).toISOString()
    : null

  const response = await chat.spaces.messages.list({
    parent: config.spaceId,
    pageSize: SYNC_PAGE_LIMIT,
    orderBy: "createTime DESC",
    ...(cursorIso ? { filter: `createTime > "${cursorIso}"` } : {}),
  })

  let inserted = 0
  let updated = 0

  for (const msg of response.data.messages ?? []) {
    if (!msg.name) continue
    // Resolve the sender to a contactable participant via the members map.
    // Missing (external sender / no email) → empty array = "no actionable
    // participants on this row". We don't stash silent room members; sender
    // only, to keep contact discovery focused.
    const senderResource = msg.sender?.name
    const sender = senderResource
      ? senderByResource.get(senderResource)
      : undefined
    const result = await upsertSourceItem({
      sourceId: ctx.id,
      organizationId: ctx.organizationId,
      // Full resource path "spaces/X/messages/Y" — keeps it round-trippable
      // through the Chat SDK (`messages.get({ name })`).
      externalId: msg.name,
      externalType: "chat_message",
      threadExternalId: msg.thread?.name?.split("/").pop() ?? null,
      sourceCreatedAt: msg.createTime ? new Date(msg.createTime) : null,
      metadataJson: {
        author: msg.sender?.displayName ?? "Unknown",
        authorType: msg.sender?.type ?? "HUMAN",
        text: msg.text ?? "",
        attachmentCount: msg.attachment?.length ?? 0,
        participants: sender
          ? [{ email: sender.email, name: sender.name }]
          : [],
      },
    })
    if (result.inserted) inserted++
    else updated++
  }

  await stampLastSyncedAt(ctx.id)

  return {
    fetched: response.data.messages?.length ?? 0,
    inserted,
    updated,
  }
}
