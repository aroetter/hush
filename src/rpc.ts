/** Own the app-server process and correlate bidirectional JSONL requests. */
import {spawn, execFile, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {createInterface} from 'node:readline';
import {promisify} from 'node:util';
import type {InitializeParams} from './protocol/InitializeParams.js';
import type {InitializeResponse} from './protocol/InitializeResponse.js';
import type {ThreadStartParams} from './protocol/v2/ThreadStartParams.js';
import type {ThreadStartResponse} from './protocol/v2/ThreadStartResponse.js';
import type {ThreadResumeParams} from './protocol/v2/ThreadResumeParams.js';
import type {ThreadResumeResponse} from './protocol/v2/ThreadResumeResponse.js';
import type {ThreadListParams} from './protocol/v2/ThreadListParams.js';
import type {ThreadListResponse} from './protocol/v2/ThreadListResponse.js';
import type {ThreadTurnsListParams} from './protocol/v2/ThreadTurnsListParams.js';
import type {ThreadTurnsListResponse} from './protocol/v2/ThreadTurnsListResponse.js';
import type {ThreadItemsListParams} from './protocol/v2/ThreadItemsListParams.js';
import type {ThreadItemsListResponse} from './protocol/v2/ThreadItemsListResponse.js';
import type {TurnStartParams} from './protocol/v2/TurnStartParams.js';
import type {TurnStartResponse} from './protocol/v2/TurnStartResponse.js';
import type {TurnSteerParams} from './protocol/v2/TurnSteerParams.js';
import type {TurnSteerResponse} from './protocol/v2/TurnSteerResponse.js';
import type {TurnInterruptParams} from './protocol/v2/TurnInterruptParams.js';

export type Id = string | number;
export interface ServerMessage {method: string; params: Record<string, any>; id?: Id}
interface Methods {
  initialize: [InitializeParams, InitializeResponse];
  'thread/start': [ThreadStartParams, ThreadStartResponse];
  'thread/resume': [ThreadResumeParams, ThreadResumeResponse];
  'thread/list': [ThreadListParams, ThreadListResponse];
  'thread/turns/list': [ThreadTurnsListParams, ThreadTurnsListResponse];
  'thread/items/list': [ThreadItemsListParams, ThreadItemsListResponse];
  'turn/start': [TurnStartParams, TurnStartResponse];
  'turn/steer': [TurnSteerParams, TurnSteerResponse];
  'turn/interrupt': [TurnInterruptParams, Record<string, never>];
}
export interface Connection {
  request<M extends keyof Methods>(method: M, params: Methods[M][0]): Promise<Methods[M][1]>;
  notify(method: string, params?: unknown): void;
  respond(id: Id, result: unknown): void;
  reject(id: Id, message: string): void;
  on(event: string, listener: (...args: any[]) => void): this;
  close(): Promise<void>;
}

export async function codexVersion(): Promise<string> {
  const {stdout} = await promisify(execFile)('codex', ['--version'], {timeout: 10_000});
  return stdout.trim();
}

/** A pending request times out visibly and is never automatically retried. */
export class RpcClient extends EventEmitter implements Connection {
  private process: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<Id, {resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}>();
  private closed = false;
  private stopping = false;

  constructor(command: string, args: string[], cwd: string, env = process.env, private timeout = 120_000) {
    super();
    this.process = spawn(command, args, {cwd, env, stdio: 'pipe'});
    const lines = createInterface({input: this.process.stdout});
    lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Expected an object');
        if (typeof message.method === 'string') {
          if (message.id !== undefined && typeof message.id !== 'string' && typeof message.id !== 'number') throw new Error('Invalid request ID');
          if (message.params != null && (typeof message.params !== 'object' || Array.isArray(message.params))) throw new Error('Invalid request parameters');
          this.emit(message.id === undefined ? 'notification' : 'request', {...message, params: message.params ?? {}});
        } else if ('id' in message && ('result' in message || 'error' in message)) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(`Codex: ${message.error.message ?? JSON.stringify(message.error)}`));
          else pending.resolve(message.result);
        } else throw new Error('Invalid protocol envelope');
      } catch (error) {
        this.emit('fault', new Error(`Invalid app-server message: ${String(error)}`));
        void this.close();
      }
    });
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', text => this.emit('log', text));
    this.process.stdin.on('error', error => this.fail(error));
    this.process.on('error', error => this.fail(error));
    this.process.on('close', (code, signal) => {
      lines.close();
      this.fail(new Error(`Codex app-server exited (${signal ?? code}). Resume the session after restarting Hush.`));
    });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (!this.stopping) this.emit('fault', error);
  }

  private send(message: unknown): void {
    if (this.closed || this.stopping) throw new Error('Codex app-server is disconnected.');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request<M extends keyof Methods>(method: M, params: Methods[M][0]): Promise<Methods[M][1]> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out. The outcome is unknown; no request was retried. Restart and resume before continuing.`));
        this.emit('fault', new Error(`${method} timed out; connection closed to avoid duplicate work.`));
        void this.close();
      }, this.timeout);
      this.pending.set(id, {resolve, reject, timer});
      try { this.send({id, method, params}); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method: string, params: unknown = {}): void { this.send({method, params}); }
  respond(id: Id, result: unknown): void { this.send({id, result}); }
  reject(id: Id, message: string): void { this.send({id, error: {code: -32601, message}}); }

  async close(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.fail(new Error('Hush disconnected.'));
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const kill = setTimeout(() => this.process.kill('SIGKILL'), 1500);
      const done = setTimeout(resolve, 2500);
      this.process.once('close', () => {clearTimeout(kill); clearTimeout(done); resolve();});
      this.process.stdin.end();
      this.process.kill('SIGTERM');
    });
  }
}
