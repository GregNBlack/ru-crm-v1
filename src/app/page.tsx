import type { Metadata } from "next"
import { HomeContent } from "./home-content"

export const metadata: Metadata = {
  title: "Business Operating System",
  description: "Demo web application",
}

export default function Home() {
  return <HomeContent />
}
