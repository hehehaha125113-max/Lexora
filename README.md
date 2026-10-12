# Lexora

A study planner with Gemini explanations, vocabulary, quizzes, and assignment breakdowns.

## Run locally

Requires Node.js 22 or newer. There are no npm dependencies to install.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Replace the key previously committed in `index.html`; removing it from the current file does not remove it from Git history.
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` there. Keep `.env` private.
3. Run `npm start` and open `http://localhost:3000`.

`GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`; choose another available Gemini model if needed. `PORT` defaults to `3000`. A static HTML server or opening the file directly cannot serve `/api/ai`.

## Deploy on Vercel

Import this repository into Vercel using the **Other** framework preset. The included `vercel.json` copies only `index.html` to the public output and deploys `api/ai.js` as a Node function.

Set `GEMINI_API_KEY` in the project's environment variables, optionally set `GEMINI_MODEL`, then deploy. Redeploy after changing environment variables. Never add the key to the HTML or commit `.env`.

GitHub Pages cannot run the Node endpoint. Other hosts must run `npm start` or provide an equivalent Node function at `/api/ai`.

The endpoint is publicly callable and consumes your Gemini quota. Cross-site browser requests are rejected, but that is not authentication. For a public production launch, configure access controls and rate limits at your host.

## Verify

Run `npm test`. Tests use synthetic local Gemini responses and do not require a real API key. The optional server-only `GEMINI_API_BASE_URL` override is for local provider emulation; use synthetic credentials with it. Leave it unset for live Gemini.

Browser requests contain the prompt only. The server authenticates to Gemini, requests JSON, parses the answer, and returns a JSON object or a readable error. Provider keys and raw provider error messages are never returned to the page.
