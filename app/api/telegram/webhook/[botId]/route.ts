export async function POST(req: Request) {
  try {
    const body = await req.json()

    const chatId = body?.message?.chat?.id
    const text = body?.message?.text || ''

    if (!chatId) return new Response('ok')

    // ⚡ достаем botId из URL
    const url = new URL(req.url)
    const botId = url.pathname.split('/').pop()

    // ⚡ получаем токен из Supabase
    const res = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/telegram_bots?slug=eq.' + botId, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    })

    const data = await res.json()
    const token = data?.[0]?.bot_token

    if (!token) return new Response('no token')

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Ты написал: ${text}`
      })
    })

    return new Response('ok')
  } catch (e) {
    return new Response('ok')
  }
}
