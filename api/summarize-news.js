export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no ambiente' });

  const { url, title } = req.query;
  if (!url) return res.status(400).json({ error: 'url obrigatória' });

  try {
    const prompt = `Resuma esta notícia em português (Brasil), em 2 a 4 frases, direto e objetivo, focando no que é relevante para o mercado financeiro. Baseie-se no conteúdo real da página vinculada.\n\nTítulo original: "${title || ''}"\nLink: ${url}`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ url_context: {} }],
        }),
      }
    );
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Gemini ${r.status}: ${t.slice(0, 200)}`);
    }
    const data = await r.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const summary = parts.map(p => p.text).filter(Boolean).join('').trim();
    if (!summary) throw new Error('resposta vazia do Gemini');

    return res.json({ summary });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
