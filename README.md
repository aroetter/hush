# Hush

**A quiet terminal UI for Codex.** Keep the conversation in view while agent activity
updates in place. Open the details panel when you want commands, diffs, or logs.

## Install and run

You need **Node.js 22+**, npm, and **Codex installed on your PATH**. For normal use,
sign in with `codex login` if you have not already.

Clone Hush and install its command:

```sh
mkdir -p ~/src
cd ~/src
git clone https://github.com/aroetter/hush.git
cd hush
npm ci          # Install dependencies
npm run build   # Compile source into dist/
npm link        # Make the hush command available outside this directory
```

Already cloned the repo? Run the last three commands from your Hush checkout.
`npm run build` alone does not install the command; `npm link` is the one-time step
that adds it to npm's global bin directory. That directory must be on your PATH.
If your shell cannot find `hush`, see [Troubleshooting](#troubleshooting).

Start Hush in the repository you want to work on:

```sh
cd ~/src/reponame    # Replace with your project's directory
hush
```

To continue a saved conversation in that project:

```sh
hush resume         # Pick a session
hush resume --last  # Or reopen the most recent session here
```

`npm link` creates symbolic links back to your Hush checkout; it does not copy the
app or replace Codex. After changing Hush's source, run `npm run build` in the Hush
checkout, then restart Hush. Keep the checkout in place while using the linked command.
To uninstall the command: `npm unlink -g @aroetter/hush`.

## What it looks like

```text
hush · ~/src/project · your model

You
Fix the failing test.

Codex
The parser now accepts empty input. The tests pass.

Codex · Running tests
Agent 2 · Reviewing the parser
▸ Details · 4 commands · 2 changed files
> ▏
```

Hush runs your installed `codex app-server` underneath. Codex handles the model,
execution, permissions, login, and saved sessions. Hush handles their presentation.
It does not replace Codex or modify its configuration.

## Everyday use

```sh
hush                                  # Start a conversation here
hush "Explain this project"           # Start with a message
hush -m MODEL                         # Choose a model
hush -c model_reasoning_effort=high    # Override a Codex setting
hush --help                           # Show supported arguments
hush --version                        # Show Hush and installed Codex versions
```

`-c` is repeatable and accepts Codex's TOML-or-string value syntax:

```sh
hush -m MODEL \
  -c model_reasoning_effort=high \
  -c approval_policy=on-request \
  -c sandbox_mode=workspace-write
```

Hush supports `-m` and `-c` explicitly. Other Codex CLI flags produce an error;
they are not silently ignored or blindly forwarded to app-server.

### Resume a session

```sh
hush resume                           # Pick a session for this directory
hush resume --last                    # Most recently updated session here
hush resume SESSION_ID                # Resume a specific session
hush resume --all                     # Pick from all directories
hush resume SESSION_ID -m MODEL -c model_reasoning_effort=high
```

Stock Codex CLI sessions and Hush sessions share Codex's storage. In the picker,
use **Up/Down** to select, **Enter** to open, and **n** to load more sessions.
Recent conversation history loads first; **Ctrl+B** loads older messages.

**The launch directory is always the working directory**, including when resuming
a session originally created elsewhere. The header shows it. There is no `-C` flag:
`cd` into the intended project first.

### Approvals and questions

Approval prompts appear even when details are collapsed. Type a displayed choice
number and press Enter; Enter alone never grants permission. File approvals show
the patch. If it changes while approval is pending, the preview updates and any
typed choice is cleared.

User questions accept an option number or free text. Secret answers are masked.
MCP form requests accept a JSON object, or `decline` / `cancel`. URL requests show
a link for you to open yourself and confirm afterward.

Hush inherits Codex's permission settings. It never automatically answers an approval
request. Unsupported server requests are rejected with a visible notice.

## Keyboard

The conversation and details have separate scroll positions. Pending requests take
priority when you use the scroll keys.

| Key | Action |
| --- | --- |
| Enter | Send a message, steer active work, or submit a prompt response |
| Alt+Enter | Insert a newline; multiline paste also works |
| Left / Right / Home / End | Move within the draft |
| Backspace / Delete | Delete before / after the cursor |
| Ctrl+U | Clear the current input |
| Ctrl+O | Expand or collapse details |
| Tab | Switch scrolling between conversation and expanded details |
| Page Up / Page Down | Scroll the selected panel |
| Ctrl+B | Load older conversation history |
| Ctrl+C | Interrupt active work; otherwise clear input; cancel startup if connecting |
| Ctrl+L | Dismiss notices; their full text stays in details |
| Ctrl+D | Exit and stop this Hush app-server |

Type `/exit` or `exit` and press Enter to quit, or use Ctrl+D. During an approval
or question, typed text answers that prompt; Ctrl+D still exits.

Hush uses the terminal's alternate screen and restores your original screen on exit.
Use its Page Up/Page Down controls instead of terminal scrollback. The terminal must
be at least **35 columns × 16 rows**. On keyboards without Page Up/Page Down, your
terminal may map them to Fn+Up / Fn+Down.

## Run all tests

From the Hush checkout:

```sh
cd ~/src/hush
npm ci
npm run test:all
```

For subsequent runs, just `npm run test:all` is enough. It stops at the first failure
and runs these checks in order:

1. **TypeScript and unit/UI tests:** arguments, transport, session state, approvals,
   history, errors, and keyboard interactions.
2. **Build:** compile the executable used by the terminal tests and installed command.
3. **Terminal tests:** run the executable in a real pseudo-terminal with a fake Codex,
   checking conversation, details, approvals, interruption, resize, resume, and cleanup.
4. **Installed-Codex compatibility test:** run your real Codex against a local fake
   model; check streaming, restart, resume, model/config overrides, and working
   directories with both legacy and paginated history.

**No paid inference, API key, or Codex login is needed for the tests.** The compatibility
test uses a temporary Codex home and a server bound to localhost; your real sessions
and configuration are not changed. You need **Python 3**, **macOS or Linux**, and
`codex` on PATH for the complete run. A restricted sandbox must permit the local
server and pseudo-terminal.

For a narrower check:

| Command | What it runs |
| --- | --- |
| `npm test` | Unit and Ink UI tests; no Codex or Python required |
| `npm run check` | TypeScript checks plus `npm test` |
| `npm run build` | Compile to `dist/` |
| `npm run test:terminal` | PTY tests; build first; Python 3 required |
| `npm run smoke` | Installed-Codex compatibility test; localhost listener required |
| `npm run test:all` | All of the above in the required order |

GitHub Actions runs TypeScript, unit/UI, build, and terminal checks on Node 22 and 24.
The installed-Codex compatibility test runs locally against the version you actually use.

## When you upgrade Codex

Hush resolves `codex` from PATH and checks its version on every launch. The current
protocol types were generated from **codex-cli 0.160.1**. A different version produces
a compatibility notice; it is not blocked merely for being newer.

To update and verify the protocol types in this checkout:

```sh
npm run protocol:refresh
npm run test:all
```

`protocol:refresh` reads the installed binary's schema and updates generated files
under `src/protocol/`. It does not upgrade Codex. Review those changes and keep all
checks passing before accepting the new protocol version. App-server is experimental;
incompatible changes may require Hush code changes too.

## Conversation formatting

Your messages are cyan; Codex replies are white, with bold speaker labels.
Replies render Markdown headings, emphasis, lists, quotes, code blocks, and tables.
Long links use numbered destination notes; narrow terminals show table rows as
labeled fields. Status lines and keyboard hints are gray. Commands, diffs, and logs
stay in the details view.

Set `NO_COLOR=1` to disable colors. User messages and approval details remain literal
text. Code blocks have no syntax highlighting.

## Troubleshooting

- **`hush` is not found:** run `npm run build` and `npm link` from this checkout.
  Check that the `bin` directory under `npm prefix -g` is on PATH.
- **`codex` is not found:** confirm `codex --version` works in the same terminal.
- **No sessions in the picker:** try `hush resume --all` or an explicit session ID.
- **Codex reports an error:** read the visible notice and open details with Ctrl+O.
- **A request times out or the server disconnects:** restart Hush and resume the session
  to inspect its outcome. Hush does not automatically resend the request.
- **`test:all` cannot bind localhost or allocate a terminal:** run it in a normal local
  terminal, outside the restricted sandbox. `npm run check` needs neither capability.

## Development and scope

```sh
npm run dev -- --help                  # Run TypeScript directly
npm run dev -- -m MODEL                # Develop against your real Codex
```

The initial version accepts text input. Image attachments, remote app-server connections,
custom client tools, and embedded MCP app UI are not implemented. Unsupported MCP
elicitation extensions are rejected visibly. Details display plain text and JSON.
Live diagnostics retain the last 200,000 characters per entry and 500 entries; output
truncation is labeled. Codex keeps its own durable history.

See [the design](docs/design.md) for the implementation boundaries and test coverage.

## License

[MIT](LICENSE) © 2026 Alex Roetter.
