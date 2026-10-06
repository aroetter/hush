# Hush

A quiet terminal UI for your installed Codex. Conversation stays visible while agent
activity updates in place. Commands, diffs, reasoning, and logs live in an expandable
panel. Approval requests, questions, warnings, and errors remain visible.

## Install

Requires Node.js 22 or newer and `codex` on your PATH. Sign in with `codex login` if
needed. Hush uses your existing Codex configuration and authentication.

```sh
cd ~/src/hush
npm ci
npm run build
npm link
```

This installs the `hush` command. It does not replace or upgrade `codex`, or edit
Codex's configuration. To remove the command, run `npm unlink -g @aroetter/hush`.

## Use

```sh
cd ~/src/your-project
hush
hush "Explain this project"
hush -m MODEL
hush -c model_reasoning_effort='"high"'
hush -c approval_policy='"on-request"' -c sandbox_mode='"workspace-write"'
hush resume
hush resume --last
hush resume SESSION_ID
hush resume --all
hush resume SESSION_ID -m MODEL -c model_reasoning_effort='"high"'
```

Hush always uses the directory you launch it from, including when resuming a session
originally created elsewhere. The header shows that directory. `resume` opens a picker;
`--last` chooses the most recently updated saved session in this directory. `--all`
includes other directories. Sessions use Codex's storage, so stock CLI sessions can
be resumed by ID or selected from the picker.

`-c` is repeatable and follows Codex's TOML-or-string value syntax. Explicit `-m`
selects the model. These overrides apply to resumed sessions too. Other Codex CLI
flags are not silently forwarded; unsupported options produce an error.

Hush inherits Codex's permission settings. It never automatically answers an approval
request or retries a failed user submission. Unknown server requests receive an error
and produce a visible notice.

## Keyboard

| Key | Action |
| --- | --- |
| Enter | Send a message, steer active work, or submit a prompt response |
| Alt+Enter | Insert a newline; pasting multiple lines also works |
| Left / Right / Home / End | Edit the current message |
| Ctrl+U | Clear the current input |
| Ctrl+O | Expand or collapse details |
| Tab | Switch scrolling between conversation and expanded details |
| Page Up / Page Down | Scroll the selected panel; pending requests take priority |
| Ctrl+B | Load an older page of conversation history |
| Ctrl+C | Interrupt active work; otherwise clear input; cancel startup if connecting |
| Ctrl+L | Dismiss visible notices; their full text remains in details |
| Ctrl+D | Exit and stop this Hush app-server; print a resume command |

In the resume picker, use Up/Down and Enter. Press `n` to load more sessions.
Approval prompts require typing a displayed choice number and pressing Enter; Enter
alone never grants permission. If a patch changes while approval is pending, its preview
updates and any typed choice is cleared. User questions accept a choice number or free text.
Secret answers are masked. MCP form requests accept a JSON object; `decline` or
`cancel` refuses them. MCP URL requests show the URL for you to open yourself.

The UI uses the terminal's alternate screen and restores your original screen on
exit. Use its Page Up/Page Down controls for history. A terminal of at least 35 columns
and 16 rows is required. Agent progress messages are available in details; final
answers and asynchronous questions remain in the conversation.

## Codex upgrades

Hush resolves `codex` from PATH and checks its version on every launch. The checked-in
protocol types were generated from **codex-cli 0.160.1**. A different version produces
a visible compatibility notice, but is not blocked merely for being newer.

After upgrading Codex, validate compatibility in this checkout:

```sh
npm run protocol:refresh
npm run check
npm run build
npm run smoke
npm run test:terminal
```

The refresh command reads the installed binary's schema and copies only the types
Hush uses, including their dependencies. It does not change Codex. Passing type checks
alone does not establish compatibility; keep the smoke test and terminal tests passing
before accepting the regenerated types. Hush does not update itself or Codex automatically.

The app-server protocol is experimental, and session history pagination requires its
experimental API capability. Future incompatible changes may require Hush code changes.
Unsupported methods, malformed messages, timeouts, and process exits are reported
visibly. A timed-out request is not resent: restart Hush and resume the session to
inspect the outcome.

## Development and verification

```sh
npm run dev -- --help
npm run check          # TypeScript and deterministic protocol/UI tests
npm run build
npm run smoke          # Installed Codex against a local fake model
npm run test:terminal  # Built executable in a real PTY; requires Python 3 and macOS/Linux
```

The smoke test uses a temporary Codex home and a local HTTP server with deterministic
responses. It verifies a streamed turn, process restart, saved-session resume, history,
and session listing without paid inference or changes to your real sessions. Unit and
terminal tests use fake app-server responses and never call a provider.

Current limits: text input only; no image attachments, remote app-server connections,
custom client tools, or embedded MCP app UI. Unsupported MCP elicitation extensions
are rejected visibly. Recent history loads first; Ctrl+B loads earlier turns. Live
logs retain the last 200,000 characters per entry and 500 diagnostic entries; truncation
is labeled. Codex retains its own durable session history. Expanded details show raw
text and JSON, not syntax-highlighted Markdown.

See [the design](docs/design.md) for the implementation boundaries and verification map.
