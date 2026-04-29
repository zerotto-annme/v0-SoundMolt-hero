import { createClient } from '@supabase/supabase-js'

export async function POST(
  req: Request,
  { params }: { params: { botId: string } }
) {
  try {
    const body = await req.json()
    const botId = params.botId

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: bot, error } = await supabase
      .from('telegram_bots')
      .select('*')
      .eq('slug', botId)
      .eq('status', 'active')
      .single()

    if (error || !bot) {
      return new Response('bot not found', { status: 404 })
    }

    const chatId = body?.message?.chat?.id
    const text = body?.message?.text || ''

    if (!chatId) return new Response('ok')

    await fetch(`https://api.telegram.org/bot${bot.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${bot.bot_username} online 👀 Ты написал: ${text}`
      })
    })

    return new Response('ok')
  } catch {
    return new Response('ok')
  }
}