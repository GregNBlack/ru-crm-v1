"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  ChevronRight,
  Loader,
  PackageCheck,
  Plus,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react"
import type { OrderClientOption } from "@/app/api/orders/route"
import type { OrderRequestItemView } from "@/app/api/order-requests/route"
import { hasAnyFilter } from "@/lib/order-request"

// ── Unified "New order" dialog ───────────────────────────────────────
// One entry point for both flows. Collects client + description, plus an
// OPTIONAL free-text client request. The request field is the switch:
//   • empty  → manual build: open the order builder with the client +
//              description preset (`onManual`).
//   • filled → AI assist: create the order_request, run the LLM split, and
//              hand the request id to the assembly wizard (`onAssemble`).
// Client is optional for the manual path (can be picked later in the builder)
// but required for the AI path (the parse needs a client).
export function NewOrderDialog({
  open,
  onOpenChange,
  onManual,
  onAssemble,
  initialClientId,
  initialRawText,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onManual: (opts: { clientId: string | null; description: string }) => void
  onAssemble: (requestId: string) => void
  // Prefill values when opened from a card's "Create order" button: the
  // linked client and the VERBATIM client message (goes straight into the
  // request textarea so the existing AI-assembly path runs on it unchanged).
  initialClientId?: string | null
  initialRawText?: string | null
}) {
  const [clientOptions, setClientOptions] = useState<OrderClientOption[]>([])
  const [clientId, setClientId] = useState<string>("")
  const [comment, setComment] = useState("")
  const [rawText, setRawText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (!open || loaded.current) return
    loaded.current = true
    fetch("/api/orders?clientOptions=1")
      .then((r) => r.json())
      .then((d) => setClientOptions(d.clients ?? []))
      .catch(() => {
        loaded.current = false
      })
  }, [open])

  // On each open, seed the form from the optional prefill props (empty when
  // opened normally from the toolbar). Runs only when `open` toggles to true
  // — the prefill props are stable for the duration of one open session.
  useEffect(() => {
    if (open) {
      setClientId(initialClientId ?? "")
      setRawText(initialRawText ?? "")
      setComment("")
    }
  }, [open, initialClientId, initialRawText])

  const reset = () => {
    setClientId("")
    setComment("")
    setRawText("")
  }

  const hasRequest = rawText.trim().length > 0

  const submit = async () => {
    // Manual path — no request text. Client optional (picked later if blank).
    if (!hasRequest) {
      onManual({ clientId: clientId || null, description: comment })
      reset()
      onOpenChange(false)
      return
    }
    // AI path — needs a client to attribute the parsed order.
    if (!clientId) {
      toast.error("Select a client to analyse the request")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/order-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, comment, rawText }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Failed to analyse the request")
        return
      }
      onAssemble(data.id as string)
      reset()
      onOpenChange(false)
    } catch {
      toast.error("Failed to analyse the request")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>
            Build manually, or paste a client&rsquo;s free-text message below to
            have it split into product requests and walk you through the order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Client</span>
            <Select value={clientId} onValueChange={setClientId} disabled={submitting}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a client (optional for manual)" />
              </SelectTrigger>
              <SelectContent>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Description</span>
            <Textarea
              rows={1}
              className="min-h-9"
              placeholder="Optional note (becomes the order description)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">
              Client request{" "}
              <span className="text-muted-foreground/70">
                — leave empty to build manually
              </span>
            </span>
            <Textarea
              rows={7}
              placeholder="Paste the WhatsApp / email / chat message here to auto-assemble the order…"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader className="h-4 w-4 mr-1 animate-spin" />
                Analysing the request…
              </>
            ) : hasRequest ? (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                Analyse &amp; start
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1" />
                Build order
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Per-step wizard strip ────────────────────────────────────────────
// Rendered above the order builder while assembling. Shows the current
// intent item + what it was matched on, and the step controls. The catalog
// table below is pre-filtered to this item's filters / search phrase; the
// rep adds products from it, then advances.
const FILTER_LABELS: Record<string, string> = {
  category: "Category",
  type: "Type",
  color: "Color",
  sugar: "Sugar",
  aging: "Aging",
  bottleVolume: "Volume",
  countryName: "Country",
  priceMin: "From ₽",
  priceMax: "To ₽",
}

export function OrderRequestWizardStrip({
  step,
  total,
  item,
  onSkip,
  onNext,
  onSkipRest,
  onClose,
}: {
  step: number
  total: number
  item: OrderRequestItemView
  onSkip: () => void
  onNext: () => void
  onSkipRest: () => void
  onClose: () => void
}) {
  const isLast = step >= total - 1

  // Chips describing how the catalog was narrowed for this step.
  const filterChips: string[] = []
  if (item.mode === "discovery" && hasAnyFilter(item.filters)) {
    for (const [key, label] of Object.entries(FILTER_LABELS)) {
      const v = (item.filters as Record<string, unknown>)[key]
      if (v !== undefined && v !== null && v !== "") {
        filterChips.push(`${label}: ${v}`)
      }
    }
  }

  return (
    <Card className="border-primary/50 bg-primary/5 dark:border-gray-600">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold">
            Request item {step + 1} of {total}
          </span>
          <Badge variant="secondary">
            {item.mode === "explicit" ? "Named product" : "Discovery"}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Exit assistant (keep the order)"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1">
          {item.label && <div className="font-medium">{item.label}</div>}
          <div className="text-sm text-muted-foreground italic">
            &ldquo;{item.rawSnippet}&rdquo;
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {item.quantityHint && (
            <Badge variant="outline" className="font-normal">
              Asked: {item.quantityHint}
            </Badge>
          )}
          {filterChips.map((c) => (
            <Badge key={c} variant="outline" className="font-normal">
              {c}
            </Badge>
          ))}
          {/* Bilingual search tokens the catalog below is ranked by. */}
          {item.searchTerms.map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Pick matching products from the catalog below and click{" "}
          <span className="font-medium">Add</span>. Adjust quantities in the
          order, then move on.
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onSkipRest}>
            Skip the rest
          </Button>
          <Button variant="outline" size="sm" onClick={onSkip}>
            <SkipForward className="h-4 w-4 mr-1" />
            Skip this
          </Button>
          <Button size="sm" onClick={onNext}>
            {isLast ? (
              <>
                <PackageCheck className="h-4 w-4 mr-1" />
                Finish &amp; review
              </>
            ) : (
              <>
                Next item
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
