# Hush

Keep the conversation with your coding agent visible while its tool activity stays
out of the way. Two versions share the name:

- **Codex:** a quiet terminal UI that wraps `codex app-server`. Expand **details**
  for commands, diffs, and logs. Everything below up to [Claude Code](#claude-code)
  covers this version.
- **Claude Code:** a mod (plugin) in [`claude/`](claude) that hides tool calls from
  the chat and lists them in an **Activity** pane. See [Claude Code](#claude-code).

## Install

Requires **Node.js 22+**, npm, and **Codex on your PATH**. Sign in with `codex login`
if needed.

```sh
git clone https://github.com/aroetter/hush.git
cd hush
npm ci
npm run build
npm link
```

`npm link` makes `hush` available globally while running the code from this checkout.
Keep the checkout; after updating its source, run `npm run build` and restart Hush.
Your installed Codex is unchanged.

## Run

Start in the repository you want to work on:

```sh
cd ~/src/reponame
hush
```

Hush runs your installed `codex app-server`, which handles models, permissions,
and saved sessions. The launch directory is the working directory, even on resume.

```sh
hush "Explain this project"           # Start with a message
hush -m MODEL                         # Choose a model
hush -c model_reasoning_effort=high    # Override a Codex setting; -c is repeatable
hush --help                           # All supported arguments
hush --version                        # Hush and installed Codex versions
```

Hush supports its documented arguments, not every Codex CLI flag.

## Resume

```sh
hush resume             # Pick a session for this directory
hush resume --last      # Most recent session here
hush resume SESSION_ID  # A specific session
hush resume --all       # Pick from all directories
```

Codex and Hush share saved sessions. In the picker, use **Up/Down**, **Enter**, and
**n** for more sessions. You can also use `-m` and `-c` when resuming.
Type `/rename My session name` in the conversation to name the session.

## Controls

| Key | Hush action |
| --- | --- |
| Ctrl+O | Expand and select Details for scrolling, or collapse it |
| Page Up / Page Down (Mac: Fn+↑ / Fn+↓) | Scroll the selected section; reaching the top of Conversation loads older messages |
| Tab | Switch scrolling between conversation and expanded details |
| Ctrl+L | Dismiss alerts |
| Ctrl+Q | Review queued questions; Esc returns to conversation |

The footer names the section being scrolled. With Details closed, scrolling applies
to Conversation. Up/Down alone navigate input history.

Enter sends; Alt+Enter adds a newline. Ctrl+C interrupts work or clears input;
Ctrl+D exits. `exit` and `/exit` also quit, except when answering a pending prompt.
Pastes of 5+ lines or 500+ characters collapse in the input. Ctrl+G expands/collapses
them; moving into a paste reveals it for editing. Enter sends the full text.
Input uses standard [readline shortcuts](https://nodejs.org/api/readline.html#tty-keybindings).

## Conversation and details

Conversation shows all main-agent messages, including replies sent while work continues.
Reasoning, commands, diffs, logs, and subagent messages stay in Details.
Your messages are cyan; replies render Markdown. A spinner shows active work;
`?` means input is needed. The status line keeps the latest progress update from
an active agent, prefixed with “Working:” or “Thinking:”. Specific tool activity
is the fallback when no progress update is available. Active-agent counts are
checked against Codex every 10 seconds; failed checks show “status unknown.” Set `NO_COLOR=1` to disable colors.

Blocking questions and approvals open automatically. Asynchronous questions keep a
visible count: Ctrl+Q opens them, then enter an option number or your own answer.
Answers are sent as ordinary messages with the question quoted; Hush never chooses
for you. Reply through this panel to clear its count. Ordinary chat replies are not
automatically treated as answers or consent. Saved questions are restored with loaded history.

Diagnostic logs, individual command/tool failures, and automatic retries stay in details; a failed
attempt does not mean the task failed. Details opens at the latest failed tool
from the current turn. Failed turns, connection problems, and requests needing
your input remain visible. Ctrl+L dismisses alerts.

## Troubleshooting

- **`hush` not found:** ensure the `bin` directory under `npm prefix -g` is on PATH.
- **Disconnected or timed out:** restart and resume. Hush does not resend requests.
- **Codex upgraded:** a protocol mismatch produces a notice; run `npm run test:all`
  to check compatibility with your installed version.

Uninstall with `npm unlink -g @aroetter/hush`.

## Development and tests

From the checkout:

```sh
npm run test:all   # TypeScript, unit/UI tests, build, terminal tests, Codex compatibility
npm run check     # TypeScript and unit/UI tests only
npm run dev       # Run directly from TypeScript
```

The full suite requires **Python 3**, **macOS or Linux**, and **Codex on PATH**.
It uses a local fake model: no paid inference, login, or API key is needed.
Run it in a terminal that permits localhost listeners and pseudo-terminals.

To update protocol types from installed Codex: `npm run protocol:refresh`, then
`npm run test:all`. Protocol changes may also require Hush code changes.

Hush currently supports text input. Image attachments, remote app-server connections,
custom client tools, and embedded MCP app UI are not implemented.
See [the design](docs/design.md) for implementation details.

## Claude Code

The mod hides tool calls (commands, diffs, output) from the Claude Code chat while
its **Activity** pane is on screen, and lists them there: newest first, marked ✓, ✗,
or … while running. Click a row to expand its input and output.

### Install from GitHub

At the prompt of a Claude Code terminal session:

```
/plugin install hush --marketplace aroetter/hush
```

Answer `y` to add the marketplace, then pick the user scope. From a shell:
`claude plugin install hush --marketplace aroetter/hush`. Update later with
`/plugin` → Marketplaces → hush → Update.

### Install from a checkout

To run the mod from this repository, with edits reloading in open sessions, add
the folder to `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/src/hush/claude" }
}
```

Use the path of your checkout; separate several folders with `:`. New sessions
load it. Use one install method, not both.

### Use

| Action | Effect |
| --- | --- |
| `/hush` | Open the pane, expanded |
| Click a row | Expand or collapse that call's input and output |
| **▸ Minimize** (`m`), or the pane's close mark | Shrink to a narrow strip; tool calls stay hidden |
| **◂ Expand** (`e`) | Restore the full pane |
| **✕ Close pane** (`x`, in the strip) | Close it; tool calls show inline again |
| **Show tools in chat** (`c`) | Toggle tool calls back into the chat |
| Ctrl+O | Claude Code's full transcript, every tool call included |

Hotkeys work while the pane has focus. The pane docks beside the chat when the
terminal is at least 110 columns wide (it opens by itself at session start from
144). In a narrower terminal it closes and tool calls show inline; widening the
terminal brings it back.

### Development

```sh
claude plugin validate claude   # manifest and hooks
claude plugin test claude       # the mod's tests
```

The mod is separate from the Codex build: `tsc` and `npm test` cover only `src/`
and `test/`.

## License

[MIT](LICENSE) © 2026 Alex Roetter.
