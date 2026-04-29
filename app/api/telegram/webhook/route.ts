export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({ ok: true, route: "telegram webhook live" })
}

export async function POST(_req: Request) {
  return Response.json({ ok: true })
}
