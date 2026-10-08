const ALLOWED_ORIGINS = new Set([
  'https://linda980506.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

function cors(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://linda980506.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}

export default function handler(req, res) {
  const origin = String(req.headers.origin || '');

  if (req.method === 'OPTIONS') {
    if (!ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({ ok: false, error: 'origin_not_allowed' });
      return;
    }
    res.status(204);
    for (const [key, value] of Object.entries(cors(origin))) res.setHeader(key, value);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405);
    for (const [key, value] of Object.entries(cors(origin))) res.setHeader(key, value);
    res.json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403);
    for (const [key, value] of Object.entries(cors(origin))) res.setHeader(key, value);
    res.json({ ok: false, error: 'origin_not_allowed' });
    return;
  }

  for (const [key, value] of Object.entries(cors(origin))) res.setHeader(key, value);
  res.status(200).json({
    ok: true,
    service: 'wangjie-ai-npc-proxy',
    model: 'gpt-6-luna',
    provider: 'openai-responses',
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    healthVersion: '2026-10-08'
  });
}
