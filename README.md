# Hush

A quiet terminal UI for Codex: keep the conversation visible while agent activity
updates in place. Expand **details** for commands, diffs, and logs.

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

The footer names the section being scrolled. With Details closed, scrolling applies
to Conversation. Up/Down alone navigate input history.

Enter sends; Alt+Enter adds a newline. Ctrl+C interrupts work or clears input;
Ctrl+D exits. `exit` and `/exit` also quit, except when answering a pending prompt.
Input uses standard [readline shortcuts](https://nodejs.org/api/readline.html#tty-keybindings).

## Conversation and details

Your messages are cyan; replies render Markdown. A spinner shows active work;
`?` means input is needed. The status line keeps the latest progress update from
an active agent, prefixed with “Working:” or “Thinking:”. Specific tool activity
is the fallback when no progress update is available. Set `NO_COLOR=1` to disable colors.

Approvals and questions appear even with details closed. Follow their numbered
choices or text instructions; Hush never answers approvals for you.

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

## License

[MIT](LICENSE) © 2026 Alex Roetter.
