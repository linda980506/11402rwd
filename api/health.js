export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).json({
    ok: true,
    service: 'wangjie-ai-npc-proxy',
    model: 'gpt-6-luna',
    provider: 'openai-responses',
    aiConfigured: Boolean(process.env.OPENAI_API_KEY)
  });
}
