// MK AI BUILDER - Phase 1 backend. Keys come from env vars or a per-request header; never logged.
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PROVIDERS = {
  gemini: { env: 'GEMINI_API_KEY', models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'] },
  groq: { env: 'GROQ_API_KEY', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  openrouter: { env: 'OPENROUTER_API_KEY', models: ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat'] }
};
const SYSTEM = 'You are MK AI BUILDER, an expert coding assistant. When asked to build a website or app, output COMPLETE files, each in its own fenced code block preceded by a line "File: <path>". Never output partial snippets.';

app.use('/api', rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }));
app.use('/api', (req, res, next) => {
  const t = process.env.ACCESS_TOKEN;
  if (t && req.get('x-access-token') !== t) return res.status(401).json({ error: 'Invalid or missing access token' });
  next();
});

const keyFor = (req, p) => (req.get('x-key-' + p) || process.env[PROVIDERS[p].env] || '').trim();

app.get('/api/providers', (req, res) => {
  const out = {};
  for (const p in PROVIDERS) out[p] = { models: PROVIDERS[p].models, serverKey: !!process.env[PROVIDERS[p].env] };
  res.json(out);
});

// Each adapter calls onText(chunk) for streamed text; throws Error with .status on failure.
async function httpStream(url, opts, parse, onText) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const e = new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
    e.status = r.status; throw e;
  }
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      if (!l.startsWith('data:')) continue;
      const d = l.slice(5).trim();
      if (!d || d === '[DONE]') continue;
      try { const t = parse(JSON.parse(d)); if (t) onText(t); } catch { /* ignore partial JSON */ }
    }
  }
}
const adapters = {
  gemini: (key, model, msgs, onText) => httpStream(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }) },
    j => j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '', onText),
  groq: (key, model, msgs, onText) => openai('https://api.groq.com/openai/v1/chat/completions', key, model, msgs, onText),
  openrouter: (key, model, msgs, onText) => openai('https://openrouter.ai/api/v1/chat/completions', key, model, msgs, onText)
};
const openai = (url, key, model, msgs, onText) => httpStream(url,
  { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: SYSTEM }, ...msgs] }) },
  j => j.choices?.[0]?.delta?.content || '', onText);

const clean = msgs => Array.isArray(msgs) && msgs.length && msgs.length <= 100 &&
  msgs.every(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length < 60000);

app.post('/api/chat', async (req, res) => {
  const { messages, provider, model, fallback = true } = req.body || {};
  if (!clean(messages)) return res.status(400).json({ error: 'Invalid messages' });
  if (!PROVIDERS[provider]) return res.status(400).json({ error: 'Unknown provider' });
  const order = [provider, ...(fallback ? Object.keys(PROVIDERS).filter(p => p !== provider) : [])];
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const errors = [];
  for (const p of order) {
    const key = keyFor(req, p);
    if (!key) { errors.push(`${p}: no API key`); continue; }
    const m = p === provider && PROVIDERS[p].models.includes(model) ? model : (p === provider && model) || PROVIDERS[p].models[0];
    let started = false;
    try {
      send({ type: 'provider', provider: p, model: m, fellBack: p !== provider });
      await adapters[p](key, m, messages, t => { started = true; send({ type: 'text', text: t }); });
      send({ type: 'done' }); return res.end();
    } catch (e) {
      errors.push(`${p}: ${e.status === 429 ? 'rate limited' : e.message}`);
      if (started) { send({ type: 'error', error: 'Stream interrupted: ' + e.message }); return res.end(); }
    }
  }
  send({ type: 'error', error: 'All providers failed. ' + errors.join(' | ') });
  res.end();
});

app.post('/api/test', async (req, res) => {
  const { provider, model } = req.body || {};
  if (!PROVIDERS[provider]) return res.status(400).json({ ok: false, error: 'Unknown provider' });
  const key = keyFor(req, provider);
  if (!key) return res.json({ ok: false, error: 'No API key configured' });
  try {
    let got = '';
    await adapters[provider](key, model || PROVIDERS[provider].models[0], [{ role: 'user', content: 'Reply with: ok' }], t => { got += t; });
    res.json({ ok: !!got, reply: got.slice(0, 40) });
  } catch (e) { res.json({ ok: false, error: e.status === 429 ? 'Rate limited' : e.message }); }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('MK AI BUILDER running on :' + port));
