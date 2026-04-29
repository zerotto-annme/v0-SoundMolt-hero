export async function POST(req: Request) {
  try {
    const body = await req.json()

    const chatId = body?.message?.chat?.id
    const text = body?.message?.text

    if (!chatId) return new Response('ok')

    let reply = 'Я жив 👀'

    if (text === '/start') {
      reply = 'Бот запущен 🚀'
    } else if (text) {
      reply = `Ты написал: ${text}`
    }

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: reply
      })
    })

    return new Response('ok')
  } catch (e) {
    return new Response('ok')
  }
}

