import "server-only"
import { google } from "googleapis"
import { getGoogleAuth, parseServiceAccountJson } from "@/lib/google-auth"
import type { GchatCredentials } from "@/server/providers/handlers"

const APP_SCOPES = [
  "https://www.googleapis.com/auth/chat.bot",
  "https://www.googleapis.com/auth/chat.app.messages.readonly",
  // Added so we can list channel members for the parser's `recipients`
  // field. If DWD doesn't have this scope authorised the listChatMembers()
  // helper fails gracefully and returns an empty list.
  "https://www.googleapis.com/auth/chat.memberships.readonly",
]

export function getChatClient(creds: GchatCredentials) {
  const auth = getGoogleAuth(
    parseServiceAccountJson(creds.serviceAccountJson),
    APP_SCOPES,
  )
  return google.chat({ version: "v1", auth })
}

export type ChatMemberDetail = {
  /** e.g. "users/12345" — matches `message.sender.name`. */
  resourceName: string
  displayName: string | null
  email: string | null
}

/**
 * List human members of a Chat space with their resource name, display
 * name, and email. Best-effort:
 *   - Excludes bots (`member.type === "BOT"`) — keeps unset/HUMAN.
 *   - Returns `[]` on *any* error (missing scope, revoked auth, transient
 *     failure), so callers treat participant extraction as non-critical.
 *
 * The Chat API's User schema in googleapis is stale — the runtime API
 * returns `email` but the TypeScript type doesn't model it, so we cast
 * narrowly to read it.
 */
export async function listChatMembersDetailed(
  creds: GchatCredentials,
  spaceName: string,
): Promise<ChatMemberDetail[]> {
  try {
    const chat = getChatClient(creds)
    const out: ChatMemberDetail[] = []
    let pageToken: string | undefined
    do {
      const response = await chat.spaces.members.list({
        parent: spaceName,
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      })
      for (const membership of response.data.memberships ?? []) {
        const user = membership.member as
          | (NonNullable<typeof membership.member> & { email?: string | null })
          | null
          | undefined
        if (!user) continue
        if (user.type && user.type !== "HUMAN") continue
        if (!user.name) continue
        out.push({
          resourceName: user.name,
          displayName: user.displayName?.trim() || null,
          email: user.email?.trim().toLowerCase() || null,
        })
      }
      pageToken = response.data.nextPageToken ?? undefined
    } while (pageToken)
    return out
  } catch (error) {
    console.warn(
      "[google-chat] listChatMembersDetailed failed — returning empty list:",
      error instanceof Error ? error.message : error,
    )
    return []
  }
}

/**
 * List human member displayNames of a Chat space. Thin wrapper over
 * `listChatMembersDetailed` preserving the existing parser callsite
 * signature (the `recipients` field wants names only). Best-effort:
 * returns `[]` on any error, skips members with no displayName.
 */
export async function listChatMembers(
  creds: GchatCredentials,
  spaceName: string,
): Promise<string[]> {
  const detailed = await listChatMembersDetailed(creds, spaceName)
  return detailed
    .map((m) => m.displayName)
    .filter((n): n is string => !!n)
}

/**
 * Download a Chat attachment's bytes server-side via domain-wide delegation
 * impersonation. Used by both the browser-facing `/api/chats/attachments`
 * proxy and the chat parser's attachment dispatcher.
 *
 * We hit the media endpoint directly (rather than via `chat.media.download()`)
 * because the googleapis client wrapper doesn't reliably include `alt=media`,
 * which the Chat media API requires for binary download; without it Google
 * returns 400. Direct fetch also surfaces Google's real error body in logs.
 */
export async function downloadChatAttachmentBytes(
  creds: GchatCredentials,
  resourceName: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const auth = getGoogleAuth(
    parseServiceAccountJson(creds.serviceAccountJson),
    ["https://www.googleapis.com/auth/chat.messages.readonly"],
    creds.impersonateUser,
  )
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token
  if (!accessToken) throw new Error("Failed to obtain access token")

  // Preserve slashes in the resource path — encodeURIComponent would mangle them.
  const url = `https://chat.googleapis.com/v1/media/${resourceName
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}?alt=media`

  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!upstream.ok) {
    const body = await upstream.text()
    throw new Error(
      `Google Chat media error ${upstream.status}: ${body.slice(0, 500)}`,
    )
  }

  const buffer = await upstream.arrayBuffer()
  return new Uint8Array(buffer)
}
