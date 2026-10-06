#!/usr/bin/env node
/** Launch Hush against the Codex on PATH, and restore the terminal when it exits. */
import {render} from 'ink';
import {HELP, parseOptions} from './args.js';
import {RpcClient, codexVersion} from './rpc.js';
import {Session} from './session.js';
import {App} from './ui.js';
import {testedCodexVersion} from './protocol/version.js';

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {console.log(HELP); return;}
  const version = await codexVersion();
  if (options.version) {console.log(`hush 0.1.0\n${version}\nProtocol tested with ${testedCodexVersion}`); return;}
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Hush needs an interactive terminal. Use codex exec for scripts.');
  const rpc = new RpcClient('codex', ['app-server', '--listen', 'stdio://', ...options.config.flatMap(value => ['-c', value])], options.cwd);
  const session = new Session(rpc, options);
  if (version !== testedCodexVersion) session.alert(`Installed ${version}; Hush was tested with ${testedCodexVersion}. Protocol errors will be reported; run the upgrade checks in the README.`);
  let quitting = false;
  const quit = () => {if (!quitting) {quitting = true; app.unmount();}};
  const app = render(<App session={session} version={version} onExit={quit}/>, {
    exitOnCtrlC: false, alternateScreen: true, incrementalRendering: true, maxFps: 20,
  });
  const signal = () => quit();
  process.on('SIGTERM', signal);
  process.on('SIGINT', signal);
  process.on('SIGHUP', signal);
  try {
    void session.start();
    await app.waitUntilExit();
  } finally {
    process.off('SIGTERM', signal);
    process.off('SIGINT', signal);
    process.off('SIGHUP', signal);
    await session.stop();
    app.cleanup();
    if (session.state.threadId) console.log(`Resume: hush resume ${session.state.threadId}`);
  }
}
main().catch(error => {console.error(`hush: ${(error as Error).message}`); process.exitCode = 1;});
