export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).json({
    ok: true,
    service: 'wangjie-ai-npc-proxy',
    model: 'openai/gpt-6-luna',
    auth: 'vercel-oidc'
  });
}
