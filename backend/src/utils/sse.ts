import { Response } from 'express';

/**
 * Shared plumbing for every streaming chat route (sandbox/interview, logistics, deep_prompts,
 * requisition Q&A) — one interaction model, decided over WebSocket, per Michael's direction:
 * a persistent bidirectional socket bought nothing this app actually used (no server-initiated
 * push independent of the client's own message — see the removed websocket/server.ts's own
 * history) and only sandbox-style chat has real token-by-token content to stream. Every route
 * still speaks the same envelope regardless — a non-streaming chain (elicitation's
 * runElicitationTurn) just emits one 'delta' frame with its whole reply before 'done', rather
 * than the client needing two different parsers for "the turn that streams" vs "the turn that
 * doesn't."
 *
 * Real `text/event-stream` framing, not a bespoke NDJSON scheme (which is what sandbox.routes.ts
 * used before this) — interoperable, and lets a frame carry a named `event:` type instead of the
 * client switching on a JSON `type` field. Not backed by the browser's native `EventSource` API
 * on the client, though: EventSource is GET-only and these are POSTs (the client has to send the
 * question/content as a body) — the frontend instead reads this framing off a `fetch()` response
 * body's ReadableStream, same plumbing sandbox's client already used, just parsing `event:`/
 * `data:` lines instead of raw NDJSON.
 */

/** Starts an SSE response. `X-Accel-Buffering: no` tells nginx not to buffer the response before
 *  relaying it (see nginx/nginx*.conf's /api/ proxy_pass) — without it the whole point of
 *  streaming is lost between here and the browser. Call once, before the first writeSSEEvent. */
export function startSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

/** Writes one SSE frame: `event: <type>\ndata: <json>\n\n`. Shared vocabulary across every
 *  route using this helper — 'delta' (a chunk of the reply, or for a non-streaming chain, the
 *  one complete reply), 'tool_call_start'/'tool_call_end' (sandbox/interview chat only — an
 *  LLM-invoked tool ran mid-turn), 'done' (the turn's final persisted result), 'citations'
 *  (sandbox only, may arrive after 'done'), 'error'. */
export function writeSSEEvent(res: Response, type: string, data: unknown): void {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
