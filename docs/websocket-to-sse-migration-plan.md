# WebSocket → POST+SSE Migration — Frontend Iteration

**Status (2026-09-13): code complete, manual E2E still open.** Tasks 1-8 below are done and
committed — `ChatStreamService` (`core/chat/chat-stream.service.ts`) replaced `WebSocketService`
(deleted, along with `core/websocket/`), `SandboxService`/`ChatPanelComponent`/
`RequisitionChatPanelComponent` all speak real SSE now, `sandbox.component.ts` shows a "Searching
your profile evidence…" indicator around `tool_call_start`/`tool_call_end`, and the stale
WebSocket-reconnection TODO in CLAUDE.md was replaced with the real equivalent gap (no retry on a
stream dropped mid-turn). `cd backend && npm test` (453 passing) and
`cd frontend && npm run test:ci` (17 passing) both stay green, and `ng build` succeeds.
**Not done:** the manual browser walkthrough in "Testing" below — `docker-compose up -d` came up
clean and `/api/auth/dev-login` + `/api/flow/progress` work, but `LLM_API_KEY` in this checkout's
`.env` is rejected by Anthropic (401 `authentication_error`), so no chat turn that calls the LLM
(logistics/deep_prompts/requisition Q&A/sandbox) can be driven end-to-end here. Swap in a working
key and run through "Testing" below before treating this migration as finished.

*Resumption point for the second (frontend) half of the transport migration described in
CLAUDE.md's "Streaming Chat (SSE)" section. The backend half is done and committed
(`28b7cb5`, "Migrate every chat surface from WebSocket to POST+SSE (backend)"); this doc is the
task list for the frontend half, deliberately done as its own iteration since doing both at once
would break the app mid-refactor. Nothing has been pushed to a remote — commit locally to `main`
as usual, same as the rest of this session's work.*

**How to resume in a new session:**
1. Read CLAUDE.md's "Streaming Chat (SSE)" section first — it's the settled design (event
   vocabulary, endpoint list, why POST+SSE over WebSocket, why not native `EventSource`). Don't
   re-litigate it; it was a multi-turn decision with the user (Michael).
2. Read this file's task list below in order — each numbered task is roughly one commit's worth
   of work, sequenced so the app is buildable (if not yet fully working) after each one.
3. `git log --oneline -10` to confirm where the previous session left off — this doc doesn't get
   updated as tasks complete, so check actual file state (`git status`, `grep` for
   `WebSocketService`) rather than trusting a checklist that might be stale.
4. Test locally end-to-end (`docker-compose up -d`, walk through logistics/deep_prompts/sandbox
   chat and an employer requisition's Q&A in the browser) before considering this done — the user
   explicitly wants everything tested locally before anything is pushed.

---

## Why this is a separate iteration

Removing `WSServer` (done, backend commit `28b7cb5`) immediately breaks every chat surface in the
running app, because the frontend's `WebSocketService`/`ChatPanelComponent`/
`RequisitionChatPanelComponent` are the *only* way those surfaces send a message today — there was
no REST fallback for the app channel before this migration. That's expected and accepted (per
Michael: "I won't push commits until it's all tested locally") — this doc exists so a fresh
session can pick up exactly where the break is and close it, rather than needing to re-derive the
whole migration's shape from scratch.

## What's already true (backend, done)

- Every chat-turn endpoint returns `text/event-stream` framing (`event: <type>\ndata: <json>\n\n`)
  via `backend/src/utils/sse.ts`'s `startSSE`/`writeSSEEvent`.
- New endpoints exist that didn't before: `GET /api/logistics/open`, `POST /api/logistics/message`,
  `GET /api/deep-prompts/open`, `POST /api/deep-prompts/message`. These are direct replacements for
  what `chat:resume`/`chat:message` did over the old `/ws?step=...` socket.
- `POST /api/requisitions/:id/qa/message` now streams the same envelope instead of returning one
  buffered JSON object (`GET /api/requisitions/:id/qa` is unchanged — still plain JSON).
- `POST /api/sandbox/message` now emits real SSE frames instead of the old bespoke
  `application/x-ndjson` lines, and additionally emits `tool_call_start`/`tool_call_end` frames
  (`{tool: 'search_candidate_evidence'}`) around the evidence-search lookup — new information the
  frontend has never had before, not just a reformatting of what it already showed.
- `/ws` is gone entirely: no route, no nginx location block (dev or prod), no `ws`/`@types/ws`
  dependency.

Full endpoint list + event vocabulary: CLAUDE.md → "Streaming Chat (SSE)".

## What's still on the old transport (frontend, this iteration's job)

| File | Current state | Needs to become |
|---|---|---|
| `frontend/src/app/core/websocket/websocket.service.ts` | Opens a `WebSocket` to `/ws?step=...` or `/ws?requisitionId=...`; exposes `connect()`/`send()`/`on(event)`/`connected()`/`disconnect()` | Replaced by a `fetch()`+`ReadableStream`-based service that POSTs and parses SSE frames — see "New shared service" below |
| `frontend/src/app/shared/components/chat-panel/chat-panel.component.ts` | `@Input() step: 'logistics'\|'deep_prompts'`; calls `ws.connect(this.step)`, sends `chat:message`/`chat:resume`, listens for `chat:message`/`progress:update`/`step:complete`/`error` | Calls the new shared SSE service against `GET .../open` + `POST .../message` for whichever step it's bound to; same public API (`@Input() step`, `@Output() completeChange`, `@Output() assistantReplied`, `@Input() infoAreas`) so `logistics-step.component.ts`/`deep-prompts.component.ts` don't need to change at all if this is done right |
| `frontend/src/app/features/employer/requisition-chat-panel.component.ts` | `@Input() requisitionId`; calls `ws.connect({requisitionId})`, sends `chat:message`, listens for `chat:message`/`requisition:complete`/`error` | Same shared SSE service, against `GET /api/requisitions/:id/qa` + `POST /api/requisitions/:id/qa/message` |
| `frontend/src/app/core/sandbox/sandbox.service.ts` | `streamMessage()` already does `fetch()`+`ReadableStream`, but parses the *old* NDJSON lines (`JSON.parse(line)` per `\n`-split line) | Parse real SSE frames instead (split on `\n\n`, then `event:`/`data:` lines — see "SSE frame parsing" below); add `tool_call_start`/`tool_call_end` to `SandboxStreamEvent`'s union |
| `frontend/src/app/features/onboarding/sandbox/sandbox.component.ts` | Switches on `event.type` (`delta`/`done`/`citations`/`error`) around line 458-480; no tool-call UI | Add a branch for `tool_call_start`/`tool_call_end` — at minimum, a transient "Searching your profile evidence…" indicator between the thinking dots and the first delta (this is genuinely new UX the backend now supports, not just a transport swap — see CLAUDE.md's rationale for why this was worth building) |

## SSE frame parsing (do this once, shared)

Every response body looks like repeated blocks of:
```
event: delta
data: {"text":"..."}

event: done
data: {"message":{...},"complete":false}

```
(blocks separated by a blank line — `\n\n`). A minimal parser, given a decoder-accumulated string
buffer `buf`:
```ts
const frames = buf.split('\n\n');
buf = frames.pop() ?? ''; // last element may be a partial frame — hold it for next read
for (const frame of frames) {
  if (!frame.trim()) continue;
  const [eventLine, dataLine] = frame.split('\n');
  const type = eventLine.replace('event: ', '');
  const data = JSON.parse(dataLine.replace('data: ', ''));
  // ... dispatch on type
}
```
This is exactly the shape the backend's own tests already assert against — see any of
`sandbox.routes.test.ts` / `logistics.routes.test.ts` / `deep-prompts.routes.test.ts` /
`requisitions.routes.test.ts`'s `parseSSE` helper for a working reference implementation (test
code, not shippable as-is, but the parsing logic is identical).

## New shared service (replaces `WebSocketService`)

Suggested shape — a `ChatStreamService` (or similar name; `core/chat/chat-stream.service.ts`) with
roughly:
```ts
open(url: string): Observable<Message[]>          // GET, plain JSON — logistics/deep_prompts/requisition-qa's "open" call
sendMessage(url: string, content: string): Observable<ChatStreamEvent>  // POST, SSE-framed
```
where `ChatStreamEvent` is a discriminated union covering `delta`/`tool_call_start`/
`tool_call_end`/`done`/`citations`/`error` (a superset — not every endpoint emits every type,
same as the backend's own vocabulary is documented as a shared-but-not-fully-overlapping set in
CLAUDE.md). Model `sendMessage`'s Observable on `SandboxService.streamMessage`'s existing shape
(`AbortController` teardown on unsubscribe, `credentials: 'include'`, wrapped in a `new
Observable(...)`) — that method already does everything a shared service needs except the actual
frame-parsing format, so this is largely "generalize what already works," not new design.

Once this exists: `SandboxService.streamMessage` can either keep its own copy (it predates this
service) or be rewritten to call the shared one — your call, but don't leave two different SSE
parsers in the codebase if it's easy to avoid.

## Task list

1. **Write the shared SSE-frame parser + `ChatStreamService`** (or fold the parser into
   `SandboxService` first and extract it once a second caller needs it — either order is fine,
   but don't ship two independent parser implementations).
2. **Rewrite `SandboxService.streamMessage`** to use real SSE parsing; add `tool_call_start`/
   `tool_call_end` to `SandboxStreamEvent`.
3. **Update `sandbox.component.ts`** to handle the two new event types — some visible "searching
   evidence" indicator, cleared on `tool_call_end` or on the first `delta`, whichever comes first.
4. **Rewrite `ChatPanelComponent`** onto `GET {step}/open` + `POST {step}/message` (where `{step}`
   is `logistics` or `deep-prompts` depending on `@Input() step`). Preserve its existing public
   API exactly (`@Input() step`, `@Input() infoAreas`, `@Output() completeChange`,
   `@Output() assistantReplied`) so `logistics-step.component.ts` and `deep-prompts.component.ts`
   need zero changes. The `extractionAreas`/glyph-tracker logic (`resolveExtractionEntries`) reads
   from each assistant message's `metadata` — that field is still present on `done`'s `message`,
   unchanged in shape, so this logic should port over untouched.
5. **Rewrite `RequisitionChatPanelComponent`** onto `GET /api/requisitions/:id/qa` +
   `POST /api/requisitions/:id/qa/message`. Preserve its `@Input() requisitionId` /
   `@Output() completeChange` API so `employer-requisition-detail.component.ts` doesn't need to
   change. `done`'s payload includes `thread` (not `progress` — a requisition has no
   `FlowProgress`) per CLAUDE.md's documented `done` shape.
6. **Delete `frontend/src/app/core/websocket/websocket.service.ts`** once nothing references it
   (`grep -rl WebSocketService frontend/src` should come back empty).
7. **Update `CLAUDE.md`'s Known TODOs bullet** — "Implement proper WebSocket reconnection
   (currently reconnects only on manual navigation back into a chat step)" is now stale (there's
   no WebSocket to reconnect). Either remove it, or replace it with whatever the equivalent gap
   is for the new transport (e.g. "a dropped SSE stream mid-turn has no automatic retry — the
   candidate has to resend"), if that gap actually exists once this is built — check rather than
   assuming symmetry with the old TODO.
8. **Update `frontend/src/app/core/*/` directory name** if you renamed `core/websocket/` — not
   required, but `core/chat/` or similar reads better than a `core/websocket/` folder holding a
   non-WebSocket service. Judgment call, not a functional requirement.
9. **Manual end-to-end test** (see below) before considering this done.
10. **Update this file's status** (or just delete it) once the migration is verified working —
    don't leave a stale "still in progress" tracker doc behind once it's true.

## Testing

- `cd backend && npm test` and `cd frontend && npm run test:ci` should both stay green throughout
  — there are no existing frontend component specs for any of the files this touches (see
  CLAUDE.md's Known TODOs — "no component tests at all" for `features/`), so this is regression
  safety on what *does* exist, not verification that the migration itself works.
- Manual verification is the real test here, since none of the touched components have specs:
  `docker-compose up -d`, then in the browser:
  - Dev-login as `devuser`, walk the resume step, then logistics (app channel) — confirm the chat
    opens (`GET /open`), a message posts and gets a reply (`POST /message`), and the step
    eventually completes and advances.
  - Same for deep_prompts.
  - Reach Step 7 (sandbox) and ask a question likely to trigger `search_candidate_evidence` (e.g.
    something the compact profile digest wouldn't cover) — confirm the new "searching" indicator
    appears and clears before the reply streams in.
  - Dev-login as `devadmin`, invite an employer (Users page → Invite a user → role `employer`),
    dev-login as that identity isn't possible today (invite-only has no dev-login shortcut for
    role `employer` — use the admin PATCH-role dropdown to flip an existing dev user to `employer`
    instead, or invite a real email you can click through), create a draft requisition, and
    complete its Q&A chat — confirm it flips to `active` and the read-only transcript renders
    afterward.
  - Open devtools' Network tab during at least one of the above and confirm the request is a plain
    `POST` (no `101 Switching Protocols`, no `ws://` entries at all).

---

*Companion to: CLAUDE.md's "Streaming Chat (SSE)" section (the settled design this implements),
`docs/employer-onboarding-implementation-plan.md` (Phase 2's frontend still being on the old
transport is noted there too — update that doc's Phase 2 section once this lands).*
