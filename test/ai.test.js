'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const server = require('../server');

let origin;
let upstream;
let providerReply = {};
let providerStatus = 200;
let lastRequest;
let providerCalls = 0;
const originalEnv = { ...process.env };

before(async () => {
  upstream = http.createServer(async (req, res) => {
    providerCalls++;
    let text = '';
    for await (const chunk of req) text += chunk;
    lastRequest = { url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(text) };
    res.writeHead(providerStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(providerReply));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  process.env.GEMINI_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  process.env.GEMINI_MODEL = 'gemini-test';
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const key of ['GEMINI_API_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_MODEL']) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  await Promise.all([server, upstream].map(s => new Promise(resolve => s.close(resolve))));
});

const request = (body, headers = {}) => fetch(`${origin}/api/ai`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const answer = parts => ({ candidates: [{ content: { parts } }] });

test('forwards a prompt to the configured Gemini model and returns parsed multipart JSON', async () => {
  providerReply = answer([{ text: '{"steps":' }, { text: '[{"title":"Read the question"}]}' }]);
  const res = await request({ prompt: 'Break down this assignment' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { steps: [{ title: 'Read the question' }] });
  assert.equal(lastRequest.url, '/v1beta/models/gemini-test:generateContent');
  assert.equal(lastRequest.key, 'synthetic-test-key');
  assert.deepEqual(lastRequest.body, {
    contents: [{ parts: [{ text: 'Break down this assignment' }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });
});

test('accepts fenced JSON and excludes thinking parts', async () => {
  providerReply = answer([{ thought: true, text: 'private reasoning' }, { text: '```json\n{"explanation":"Hola"}\n```' }]);
  const res = await request({ prompt: 'Explain' });
  assert.deepEqual(await res.json(), { explanation: 'Hola' });
});

test('accepts bodies parsed by a serverless host', async () => {
  const handler = require('../api/ai');
  providerReply = answer([{ text: '{"explanation":"Hola"}' }]);
  for (const body of [{ prompt: 'Explain' }, '{"prompt":"Explain"}']) {
    let output;
    const response = { setHeader() {}, end(text) { output = JSON.parse(text); } };
    await handler({ method: 'POST', headers: {}, body }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(output, { explanation: 'Hola' });
  }
});

test('rejects missing, empty, oversized and malformed prompts before contacting Gemini', async () => {
  const calls = providerCalls;
  for (const body of [null, {}, { prompt: 4 }, { prompt: '  ' }, { prompt: 'x'.repeat(20001) }]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal((await fetch(`${origin}/api/ai`, { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request({ prompt: 'x'.repeat(100001) })).status, 413);
  assert.equal(providerCalls, calls);
});

test('rejects non-POST and cross-site requests', async () => {
  const res = await fetch(`${origin}/api/ai`);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.equal((await request({ prompt: 'Explain' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('reports missing configuration without using the provider', async () => {
  delete process.env.GEMINI_API_KEY;
  try {
    const res = await request({ prompt: 'Explain' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /GEMINI_API_KEY/);
  } finally { process.env.GEMINI_API_KEY = 'synthetic-test-key'; }
});

test('handles provider errors without exposing provider messages or keys', async () => {
  for (const status of [400, 401, 403, 404, 429, 500]) {
    providerStatus = status;
    providerReply = { error: { message: 'synthetic-test-key private provider details' } };
    const res = await request({ prompt: 'Explain' });
    assert.equal(res.status, status === 429 ? 429 : 502);
    assert.doesNotMatch(await res.text(), /synthetic-test-key|private provider details/);
  }
  providerStatus = 200;
});

test('handles blocked, missing and malformed Gemini output', async () => {
  for (const reply of [answer([{ text: 'not JSON' }]), answer([{ text: 'null' }]), answer([{ text: '[]' }]), {}]) {
    providerReply = reply;
    assert.equal((await request({ prompt: 'Explain' })).status, 502);
  }
  providerReply = { promptFeedback: { blockReason: 'SAFETY' } };
  assert.equal((await request({ prompt: 'Explain' })).status, 422);
});

test('handles transport and timeout errors', async () => {
  const realFetch = global.fetch;
  for (const name of ['TypeError', 'TimeoutError']) {
    global.fetch = async (url, options) => {
      if (url.startsWith(process.env.GEMINI_API_BASE_URL)) {
        const error = new Error('synthetic failure'); error.name = name; throw error;
      }
      return realFetch(url, options);
    };
    try {
      const res = await realFetch(`${origin}/api/ai`, {
        method: 'POST', body: JSON.stringify({ prompt: 'Explain' })
      });
      assert.equal(res.status, 502);
      assert.match((await res.json()).error, name === 'TimeoutError' ? /too long/ : /connect/);
    } finally { global.fetch = realFetch; }
  }
});

test('serves the page but never exposes environment or backend files', async () => {
  const res = await fetch(origin);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /fetch\('\/api\/ai'/);
  assert.doesNotMatch(html, /GEMINI_API_KEY|synthetic-test-key/);
  for (const file of ['.env', 'server.js', 'api/ai.js', 'package.json', '..%2f.env']) {
    assert.equal((await fetch(`${origin}/${file}`)).status, 404);
  }
});
