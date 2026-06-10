import { NextRequest, NextResponse } from "next/server"
import { getProduct } from "@/server/products"

export { type ProductDetail } from "@/server/products"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

// GET /api/products/[id] — full single-product detail for the preview
// pop-up. Loaded lazily (only when the dialog opens), so the heavy JSON
// metadata groups never ship with the table listing. 404 when the id
// isn't found in the caller's active org.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    const product = await getProduct(id)
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }
    return NextResponse.json({ product })
  } catch (error) {
    return errorResponse(error)
  }
}
