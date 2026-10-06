# Quiet conversation, unchanged Codex execution

Hush is a local terminal client for one privately launched `codex app-server` process.
It keeps user messages, answers, and asynchronous questions in a scrollable conversation.
Progress updates replace status rows. Tool details never become scrolling chat messages.
Codex owns authentication, permissions, execution, and durable session history.

## Boundaries

- `args.ts` accepts the supported CLI arguments and configuration overrides. The launch
  directory is passed explicitly when starting or resuming a session.
- `rpc.ts` owns the subprocess, JSONL framing, request correlation, stderr, timeouts,
  and shutdown. No shell interprets arguments. Requests are never automatically retried.
- `session.ts` manages one conversation and incoming agent activity. It loads recent
  history first, merges item updates by ID, and buffers notifications while loading
  history so live updates are not overwritten. A page becomes visible only after all
  its items load successfully. A disconnected connection cannot become ready again
  from a late startup response. Older pages load on request.
- `approvals.ts` translates server requests into explicit UI choices. Missing file-change
  details disable acceptance. Patch updates replace the approval preview and clear any
  typed choice; replies for an older preview are rejected. Permission grants are limited
  to the current turn. Unknown
  request types fail visibly, so neither silent approval nor an unanswered request occurs.
- `view.ts` derives conversation and details text. Terminal escape sequences are removed
  from external text before rendering.
- `ui.tsx` owns transient display state: draft, scroll positions, selected session, and
  unsubmitted answers. Fixed-height panels keep activity from scrolling the conversation.
  Collapsed details are not formatted during typing or streaming.
- `cli.tsx` checks the installed version, starts the client, and restores the terminal.
  Generated types in `protocol/` describe the installed version used during development.

A new message starts a turn. During active work it uses `turn/steer` with the active
turn ID. Ctrl+C requests `turn/interrupt` and waits for completion before accepting
another message. Ctrl+D shuts down this private server and leaves saved history with
Codex. Hush stores no separate session database and edits no Codex configuration files.

On resume, `thread/resume` restores execution state, and `thread/turns/list` loads recent
turns. If a turn's items are incomplete, `thread/items/list` hydrates them page by page.
Control requests time out after two minutes. Because the outcome might be unknown,
Hush closes the connection and tells the user to restart and resume rather than retrying.

## Verification

- `args.test.ts`: supported commands, model/config overrides, invalid arguments.
- `rpc.test.ts`: out-of-order replies, bidirectional requests, separated logs, malformed
  messages, missing executable, timeout, and process exit.
- `session.test.ts`: conversation/detail routing, streaming, history pagination,
  steering, interruption, completion races, explicit approvals, failures, and safe text.
- `ui.test.tsx`: actual Ink keyboard handlers for sending, details, approvals,
  masked multi-question answers, and session selection.
- `scripts/terminal-smoke.py`: compiled executable in a PTY, including resize and
  alternate-screen restoration. An isolated fake `codex` on PATH prevents real work.
- `scripts/smoke.ts`: installed Codex against a local fake Responses provider, including
  a restart and saved-session resume. No paid inference or real session changes.

## Scope decisions

There is no daemon, web server in the product, plugin system, copied login state,
parallel session store, or automatic updater. The local HTTP server exists only in the
smoke test. Additional CLI flags, images, remote connections, and richer Markdown
rendering are deferred. Required complexity is concentrated at the protocol boundary:
request IDs, approval responses, turn state, and paginated history.
