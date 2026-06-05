// netlify/functions/claude.js
//
// Serverless proxy between the frontend and the Anthropic API.
//
// Why this exists: browsers block requests to api.anthropic.com because
// Anthropic does not include CORS headers in their responses. More importantly,
// calling the API directly from the browser would expose the API key in the
// page source. This function runs on Netlify's servers, so the key stays
// server-side and is never sent to the client.
//
// How it works:
//   Browser → POST /.netlify/functions/claude (no key needed)
//           → this function adds the key and forwards the request
//           → Anthropic API
//           ← response flows back the same way

// These headers are attached to every response this function sends.
// They tell the browser it is allowed to accept the response even when
// the request originated from a different domain (e.g. during local dev
// when the frontend runs on localhost:3000 and the function is elsewhere).
// On the live Netlify site the frontend and function share the same domain,
// so CORS is not strictly required — but including it costs nothing and
// makes the function usable from any origin without changes.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Netlify invokes this export for every request to the function's URL.
exports.handler = async (event) => {

  // ── CORS preflight ──────────────────────────────────────────────────────────
  // Before sending a cross-origin POST, browsers automatically send an OPTIONS
  // request to ask the server whether the real request is permitted. We reply
  // with the allowed headers and methods so the browser proceeds. Without this
  // the actual POST would be blocked before it left the browser.
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,   // 204 No Content — preflight responses have no body
      headers: CORS_HEADERS,
      body: "",
    };
  }

  // ── Method guard ────────────────────────────────────────────────────────────
  // The Anthropic Messages API only accepts POST. Reject anything else early
  // so we don't waste a roundtrip forwarding a request that will fail anyway.
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ── API key ─────────────────────────────────────────────────────────────────
  // Read the key from the Netlify environment at call time, not at deploy time.
  // Set it in the Netlify dashboard: Site settings → Environment variables →
  // add a variable named ANTHROPIC_API_KEY with your key as the value.
  // The key is never written to this file, never sent to the browser, and never
  // appears in any response body.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Server misconfiguration: ANTHROPIC_API_KEY environment variable is not set",
      }),
    };
  }

  // ── Forward the request ─────────────────────────────────────────────────────
  // The frontend sends exactly the body that Anthropic expects:
  //   { model, max_tokens, messages }
  // We pass it through unchanged and only add the authentication headers that
  // the frontend cannot safely provide itself.
  let anthropicResponse;
  try {
    anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type":      "application/json",
        "x-api-key":         apiKey,            // added here, never from the client
        "anthropic-version": "2023-06-01",      // required by the Anthropic API
      },
      body: event.body,   // the raw request body from the frontend, forwarded as-is
    });
  } catch (err) {
    // fetch() itself threw — this means we never reached Anthropic (network
    // failure, DNS error, timeout). Return a 502 Bad Gateway to distinguish
    // this from an error Anthropic returned deliberately.
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Could not reach Anthropic API",
        detail: err.message,
      }),
    };
  }

  // ── Return the response ─────────────────────────────────────────────────────
  // Forward Anthropic's status code back to the frontend so it can tell the
  // difference between a successful response and an API-level error (e.g. 401
  // invalid key, 429 rate limit). The frontend's existing error handling
  // already checks response.ok, so no changes needed there.
  const data = await anthropicResponse.json();

  return {
    statusCode: anthropicResponse.status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json",
    },
    body: JSON.stringify(data),
  };
};
