'use strict';

const MAX_PROMPT = 20000;

module.exports = async function ai(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(405, { error: 'Use POST for AI requests.' });
  }
  // Reject cross-site browser requests before spending provider credits.
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return reply(403, { error: 'AI requests must come from Lexora.' });
  }
  let body;
  try {
    if (req.body !== undefined) {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } else {
      let raw = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > 100000) return reply(413, { error: 'The request is too large.' });
      }
      body = JSON.parse(raw);
    }
  } catch {
    return reply(400, { error: 'Send a valid JSON request.' });
  }
  if (!body || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > MAX_PROMPT) {
    return reply(400, { error: 'Enter a prompt between 1 and 20,000 characters.' });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply(503, { error: 'AI is not configured. Set GEMINI_API_KEY on the server.' });
  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const base = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: body.prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(55000)
    });
    if (!response.ok) {
      if (response.status === 429) return reply(429, { error: 'AI is busy or its quota is exhausted. Try again later.' });
      if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
        return reply(502, { error: 'Gemini rejected the request. Check the server API key and model configuration.' });
      }
      return reply(502, { error: 'Gemini is unavailable. Try again later.' });
    }
    const data = await response.json();
    const candidate = data.candidates && data.candidates[0];
    if ((data.promptFeedback && data.promptFeedback.blockReason) || (candidate && candidate.finishReason === 'SAFETY')) {
      return reply(422, { error: 'Gemini could not answer this text. Try rephrasing it.' });
    }
    const parts = candidate && candidate.content && candidate.content.parts;
    const text = Array.isArray(parts) ? parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('') : '';
    let result;
    try {
      result = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid result');
    } catch {
      return reply(502, { error: 'The answer came back garbled. Try again.' });
    }
    return reply(200, result);
  } catch (error) {
    return reply(502, { error: error.name === 'TimeoutError' ? 'AI took too long to respond. Try again.' : 'Could not connect to Gemini. Try again.' });
  }
};
