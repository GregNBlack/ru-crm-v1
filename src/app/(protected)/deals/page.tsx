import { listDeals, listDealFunnelStages } from "@/server/deals"
import { getServerSession } from "@/lib/get-session"
import { DealsBoard } from "@/components/blocks/deals-board"

export default async function DealsPage() {
  const [deals, stages, session] = await Promise.all([
    listDeals({ includeCancelled: false, includeDeleted: false }),
    listDealFunnelStages(),
    getServerSession(),
  ])
  const currentUserId = session?.user.id ?? ""

  return (
    <div className="h-[calc(100vh-1rem)]">
      <DealsBoard
        deals={deals}
        stages={stages}
        currentUserId={currentUserId}
      />
    </div>
  )
}
