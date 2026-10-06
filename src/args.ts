/** Parse Hush's supported CLI options without passing UI flags to app-server. */
import {parseArgs} from 'node:util';
import {parse} from 'smol-toml';

export interface Options {
  cwd: string;
  model?: string;
  config: string[];
  overrides: Record<string, unknown>;
  resume?: 'picker' | 'last' | {id: string};
  all: boolean;
  prompt?: string;
  help: boolean;
  version: boolean;
}

export const HELP = `hush — a quiet terminal UI for Codex

Usage: hush [-m MODEL] [-c KEY=VALUE] [PROMPT]
       hush resume [SESSION_ID | --last] [--all] [-m MODEL] [-c KEY=VALUE]

  -m, --model MODEL       Select a model (also on resume)
  -c, --config KEY=VALUE  Override Codex configuration; repeatable
      --last             Resume the most recently updated session here
      --all              Include other directories in the session picker
  -h, --help             Show help
  -V, --version          Show Hush and installed Codex versions

Uses the current directory, your existing Codex login, and Codex configuration.
Keys: Ctrl+O details · PgUp/PgDn scroll · Ctrl+C interrupt · Ctrl+D exit
In details, Tab changes the scroll target. Enter sends; Alt+Enter adds a line.
`;

export function parseOptions(args: string[], cwd = process.cwd()): Options {
  const {values, positionals} = parseArgs({args, allowPositionals: true, options: {
    model: {type: 'string', short: 'm'}, config: {type: 'string', short: 'c', multiple: true},
    last: {type: 'boolean'}, all: {type: 'boolean'},
    help: {type: 'boolean', short: 'h'}, version: {type: 'boolean', short: 'V'},
  }});
  const config = values.config ?? [];
  const overrides: Record<string, unknown> = {};
  for (const entry of config) {
    const equal = entry.indexOf('=');
    if (equal < 1 || !entry.slice(0, equal).trim()) throw new Error('-c requires KEY=VALUE.');
    const value = entry.slice(equal + 1);
    // Codex treats values that are not TOML as plain strings.
    let parsed: unknown;
    try { parsed = parse(`value = ${value}`).value; } catch { parsed = value; }
    overrides[entry.slice(0, equal).trim()] = parsed;
  }
  const options: Options = {cwd, model: values.model, config, overrides,
    all: values.all ?? false, help: values.help ?? false, version: values.version ?? false};
  if (options.help || options.version) return options;
  if (positionals[0] === 'resume') {
    if (positionals.length > 2) throw new Error('Usage: hush resume [SESSION_ID | --last]');
    if (values.last && positionals[1]) throw new Error('Use either a session ID or --last.');
    options.resume = positionals[1] ? {id: positionals[1]} : values.last ? 'last' : 'picker';
  } else {
    if (values.last || values.all) throw new Error('--last and --all require hush resume.');
    if (positionals.length > 1) throw new Error('Put the initial prompt in quotes.');
    options.prompt = positionals[0];
  }
  return options;
}
