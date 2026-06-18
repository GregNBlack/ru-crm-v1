import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/blocks/app-sidebar"
import { getServerSession } from "@/lib/get-session"
import { redirect } from "next/navigation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession()
  if (!session?.user) redirect("/sign-in")

  return (
    <SidebarProvider
      style={
        // Ширина сайдбара под содержимое: задаётся самым широким элементом —
        // шапкой «логотип + business OS + кнопка». Узкого дефолта (11rem) не
        // хватало, из-за чего заголовок переносился на две строки.
        { "--sidebar-width": "14rem" } as React.CSSProperties
      }
    >
      <AppSidebar session={session} />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </SidebarProvider>
  )
}
