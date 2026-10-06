/** Drive one conversation, retaining tool details separately from visible answers. */
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import type {Options} from './args.js';
import type {Connection, ServerMessage, Id} from './rpc.js';
import type {Thread} from './protocol/v2/Thread.js';
import type {ThreadItem} from './protocol/v2/ThreadItem.js';
import type {Turn} from './protocol/v2/Turn.js';
import type {ThreadItemsListResponse} from './protocol/v2/ThreadItemsListResponse.js';
import type {JsonValue} from './protocol/serde_json/JsonValue.js';
import {makePrompt, type Prompt} from './approvals.js';

export interface Item {threadId: string; turnId: string; value: ThreadItem; complete: boolean}
export interface Activity {name: string; text: string; running: boolean}
export interface State {
  phase: 'connecting' | 'picking' | 'ready' | 'disconnected';
  threadId?: string;
  model?: string;
  name?: string;
  activeTurn?: string;
  sending: boolean;
  interrupting: boolean;
  items: Item[];
  activities: Map<string, Activity>;
  details: Map<string, string>;
  prompts: Prompt[];
  alerts: string[];
  sessions: Thread[];
  sessionsCursor: string | null;
  historyCursor: string | null;
  loadingHistory: boolean;
}

export class Session extends EventEmitter {
  state: State = {phase: 'connecting', sending: false, interrupting: false, items: [], activities: new Map(),
    details: new Map(), prompts: [], alerts: [], sessions: [], sessionsCursor: null, historyCursor: null, loadingHistory: false};
  private itemIndex = new Map<string, Item>();
  private completedTurns = new Set<string>();
  private connectingEvents: ServerMessage[] = [];
  private hydrating = false;
  private stopped = false;
  private interruptPending = false;
  private failure?: Error;

  constructor(readonly rpc: Connection, readonly options: Options) {
    super();
    rpc.on('notification', (event: ServerMessage) => {
      try {
        if (this.hydrating) this.connectingEvents.push(event);
        else this.notification(event);
      } catch (error) { this.disconnected(new Error(`Unsupported Codex event ${event.method}: ${String(error)}`)); }
    });
    rpc.on('request', (event: ServerMessage) => {
      try { this.serverRequest(event); }
      catch (error) { this.alert(`Unsupported request ${event.method}: ${String(error)}`); rpc.reject(event.id!, 'Invalid or unsupported request.'); }
    });
    rpc.on('log', (text: string) => {
      this.detail('App-server log', `${this.state.details.get('App-server log') ?? ''}${text}`);
      if (/\b(error|fatal|panic)\b/i.test(text)) this.alert('Codex logged an error; open details to inspect the app-server log.');
      else this.changed();
    });
    rpc.on('fault', (error: Error) => this.disconnected(error));
  }

  private changed(): void { this.emit('change'); }
  private detail(key: string, text: string): void {
    // Keep diagnostic memory bounded; Codex retains the session's durable history.
    this.state.details.set(key, text.length > 200_000 ? '[Earlier output omitted from live view]\n' + text.slice(-200_000) : text);
    if (this.state.details.size > 500) this.state.details.delete(this.state.details.keys().next().value!);
  }
  alert(message: string): void {
    if (!this.state.alerts.includes(message)) this.state.alerts.push(message);
    this.detail(`Notice ${this.state.details.size}`, message);
    this.changed();
  }
  dismissAlerts(): void { this.state.alerts = []; this.changed(); }
  private disconnected(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.state.phase = 'disconnected';
    this.state.sending = false;
    this.state.prompts = [];
    this.alert(error.message);
    void this.rpc.close();
  }

  private ensureConnected(): void {
    if (this.failure) throw this.failure;
    if (this.stopped) throw new Error('Hush is shutting down.');
  }

  async start(): Promise<void> {
    try {
      await this.rpc.request('initialize', {clientInfo: {name: 'hush', title: 'Hush', version: '0.1.0'},
        capabilities: {experimentalApi: true, requestAttestation: false}});
      this.rpc.notify('initialized');
      if (this.options.resume && typeof this.options.resume === 'object') await this.open(this.options.resume.id);
      else if (this.options.resume) {
        await this.listSessions();
        if (this.options.resume === 'last') {
          const thread = this.state.sessions[0];
          if (!thread) throw new Error('No saved sessions found. Run hush to start one.');
          await this.open(thread.id);
        } else { this.state.phase = 'picking'; this.changed(); }
      } else await this.open();
      if (this.options.prompt && this.state.phase === 'ready') await this.send(this.options.prompt);
    } catch (error) { this.disconnected(error as Error); }
  }

  async listSessions(more = false): Promise<void> {
    const page = await this.rpc.request('thread/list', {cwd: this.options.all ? null : this.options.cwd,
      sortKey: 'updated_at', sortDirection: 'desc', modelProviders: [],
      limit: 50, cursor: more ? this.state.sessionsCursor : null});
    this.ensureConnected();
    this.state.sessions = more ? [...this.state.sessions, ...page.data] : page.data;
    this.state.sessionsCursor = page.nextCursor;
    this.changed();
  }

  async open(id?: string): Promise<void> {
    this.state.phase = 'connecting';
    this.hydrating = true;
    this.changed();
    try {
      const params = {cwd: this.options.cwd, model: this.options.model,
        config: this.options.overrides as Record<string, JsonValue>};
      const response = id
        ? await this.rpc.request('thread/resume', {...params, threadId: id, excludeTurns: true})
        : await this.rpc.request('thread/start', params);
      this.ensureConnected();
      this.state.threadId = response.thread.id;
      this.state.model = response.model;
      this.state.name = response.thread.name ?? undefined;
      this.state.activities.set(response.thread.id, {name: 'Codex', text: 'Ready', running: false});
      if (id) await this.loadHistory();
      for (const turn of response.thread.turns ?? []) this.hydrateTurn(turn);
      this.ensureConnected();
      this.state.phase = 'ready';
    } catch (error) {
      this.state.phase = !this.failure && this.state.sessions.length ? 'picking' : 'disconnected';
      throw error;
    } finally {
      this.hydrating = false;
      for (const event of this.connectingEvents.splice(0)) this.notification(event);
      this.changed();
    }
  }

  /** Load recent turns first, with all items; older pages are available on demand. */
  async loadHistory(): Promise<void> {
    if (!this.state.threadId || this.state.loadingHistory) return;
    this.state.loadingHistory = true;
    const alreadyHydrating = this.hydrating;
    this.hydrating = true;
    this.changed();
    try {
      const page = await this.rpc.request('thread/turns/list', {threadId: this.state.threadId,
        cursor: this.state.historyCursor, limit: 20, sortDirection: 'desc', itemsView: 'full'});
      this.ensureConnected();
      if (page.nextCursor && page.nextCursor === this.state.historyCursor) throw new Error('Codex returned a repeated turn cursor.');
      const turns = [...page.data].reverse();
      for (const turn of turns) {
        if (turn.itemsView !== 'full') {
          let cursor: string | null = null;
          const seen = new Set<string>();
          turn.items = [];
          do {
            const items: ThreadItemsListResponse = await this.rpc.request('thread/items/list', {threadId: this.state.threadId,
              turnId: turn.id, cursor, limit: 100, sortDirection: 'asc'});
            this.ensureConnected();
            turn.items.push(...items.data.map(entry => entry.item));
            cursor = items.nextCursor;
            if (cursor && seen.has(cursor)) throw new Error('Codex returned a repeated history cursor.');
            if (cursor) seen.add(cursor);
          } while (cursor);
        }
      }
      // Commit a complete page at once so a failed fetch leaves visible history intact.
      const previous = [...this.state.items];
      const newItems: Item[] = [];
      for (const turn of turns) {
        const before = this.state.items.length;
        this.hydrateTurn(turn);
        newItems.push(...this.state.items.slice(before));
      }
      this.state.items = [...newItems, ...previous];
      this.state.historyCursor = page.nextCursor;
    } finally {
      this.state.loadingHistory = false;
      if (!alreadyHydrating) {
        this.hydrating = false;
        for (const event of this.connectingEvents.splice(0)) this.notification(event);
      }
      this.changed();
    }
  }

  private hydrateTurn(turn: Turn): void {
    for (const item of turn.items) this.upsert(this.state.threadId!, turn.id, item, turn.status !== 'inProgress', true);
    if (turn.status === 'inProgress') this.state.activeTurn = turn.id;
    else this.completedTurns.add(turn.id);
    if (turn.error) this.detail(`Historical turn ${turn.id}`, turn.error.message);
  }

  private upsert(threadId: string, turnId: string, value: ThreadItem, complete: boolean, history = false): void {
    const key = `${threadId}:${value.id}`;
    let item = this.itemIndex.get(key);
    if (!item) {
      item = {threadId, turnId, value, complete};
      this.itemIndex.set(key, item);
      this.state.items.push(item);
    } else { item.value = {...item.value, ...value} as ThreadItem; item.complete = complete || item.complete; }
    if (value.type === 'userMessage' && value.clientId) {
      this.state.items = this.state.items.filter(entry => entry.value.id !== `pending:${value.clientId}`);
      this.itemIndex.delete(`${threadId}:pending:${value.clientId}`);
    }
    if (value.type === 'fileChange') {
      this.state.prompts = this.state.prompts.map(prompt => {
        if (prompt.request.method !== 'item/fileChange/requestApproval' || prompt.request.params.itemId !== value.id || prompt.threadId !== threadId) return prompt;
        const updated = makePrompt(prompt.request, value)!;
        return updated.body === prompt.body ? prompt : {...updated, revision: prompt.revision + 1};
      });
    }
    if (history) return;
    this.activity(item);
    if (value.type === 'commandExecution' && complete && (value.exitCode || value.status === 'failed')) this.alert(`Command failed (exit ${value.exitCode ?? 'unknown'}). See details.`);
    if (value.type === 'fileChange' && value.status === 'failed') this.alert('File change failed. See details.');
    if (value.type === 'mcpToolCall' && value.error) this.alert(`Tool ${value.tool}: ${value.error.message}`);
    if (value.type === 'dynamicToolCall' && (value.success === false || value.status === 'failed')) this.alert(`Tool ${value.tool} failed. See details.`);
  }

  private activity(item: Item): void {
    const v = item.value;
    const old = this.state.activities.get(item.threadId);
    let text: string | undefined;
    if (v.type === 'agentMessage') text = v.phase === 'commentary' ? v.text : 'Writing answer';
    if (v.type === 'reasoning') text = 'Thinking';
    if (v.type === 'commandExecution') {
      const action = v.commandActions?.[0];
      text = item.complete ? 'Working' : action?.type === 'read' ? `Reading ${action.name}` : action?.type === 'search' ? 'Searching files' : 'Running command';
    }
    if (v.type === 'fileChange') text = item.complete ? 'Working' : 'Editing files';
    if (v.type === 'webSearch') text = 'Searching the web';
    if (v.type === 'mcpToolCall' || v.type === 'dynamicToolCall') text = item.complete ? 'Working' : `Using ${v.tool}`;
    if (v.type === 'contextCompaction') text = 'Compacting conversation';
    if (v.type === 'collabAgentToolCall') {
      text = 'Coordinating agents';
      for (const [id, agent] of Object.entries(v.agentsStates ?? {})) if (agent) {
        this.state.activities.set(id, {name: this.state.activities.get(id)?.name ?? `Agent ${id.slice(0, 8)}`, text: agent.status, running: agent.status === 'running' || agent.status === 'pendingInit'});
        if (agent.message) this.detail(`Agent ${id}`, agent.message);
        if (agent.status === 'errored') this.alert(`Agent ${id.slice(0, 8)} failed. See details.`);
      }
    }
    if (v.type === 'subAgentActivity') this.state.activities.set(v.agentThreadId, {name: v.agentPath, text: v.kind, running: v.kind === 'started' || v.kind === 'interacted'});
    if (text) this.state.activities.set(item.threadId, {name: old?.name ?? `Agent ${item.threadId.slice(0, 8)}`, text, running: true});
  }

  private notification(event: ServerMessage): void {
    const {method, params: p} = event;
    if (method === 'thread/started') {
      const t = p.thread;
      if (t?.parentThreadId) this.state.activities.set(t.id, {name: t.agentNickname ?? t.agentRole ?? `Agent ${t.id.slice(0, 8)}`, text: t.status?.type ?? 'Starting', running: t.status?.type === 'active'});
    } else if (method === 'thread/status/changed') {
      const old = this.state.activities.get(p.threadId);
      this.state.activities.set(p.threadId, {name: old?.name ?? 'Codex', text: p.status.activeFlags?.join(', ') || p.status.type, running: p.status.type === 'active' && !p.status.activeFlags?.length});
      if (p.status.type === 'systemError') this.alert('Codex reported a session error. See details.');
    } else if (method === 'thread/name/updated') {
      if (p.threadId === this.state.threadId) this.state.name = p.threadName ?? undefined;
      this.state.sessions = this.state.sessions.map(thread => thread.id === p.threadId ? {...thread, name: p.threadName} : thread);
    } else if (method === 'thread/settings/updated' && p.threadId === this.state.threadId) {
      this.state.model = p.threadSettings?.model ?? this.state.model;
    } else if (method === 'turn/started') {
      this.state.activities.set(p.threadId, {name: this.state.activities.get(p.threadId)?.name ?? 'Codex', text: 'Working', running: true});
      if (p.threadId === this.state.threadId) {
        this.state.activeTurn = p.turn.id;
        this.state.interrupting = false;
        if (this.interruptPending) void this.interrupt();
      }
    } else if (method === 'turn/completed') {
      this.completedTurns.add(p.turn.id);
      if (p.threadId === this.state.threadId && this.state.activeTurn === p.turn.id) {
        this.state.activeTurn = undefined;
        this.state.interrupting = false;
        this.interruptPending = false;
      }
      this.state.prompts = this.state.prompts.filter(prompt => !(prompt.threadId === p.threadId && prompt.turnId === p.turn.id));
      this.state.activities.set(p.threadId, {name: this.state.activities.get(p.threadId)?.name ?? 'Codex', text: p.turn.status === 'completed' ? 'Ready' : p.turn.status, running: false});
      if (p.turn.error || p.turn.status === 'failed') this.alert(p.turn.error?.message ?? 'Turn failed.');
      if (p.turn.status === 'interrupted') this.alert('Turn interrupted. You can send another message.');
    } else if (method === 'item/started' || method === 'item/completed') {
      this.upsert(p.threadId, p.turnId, p.item, method === 'item/completed');
    } else if (method === 'item/agentMessage/delta') {
      const item = this.itemIndex.get(`${p.threadId}:${p.itemId}`);
      const old = item?.value;
      this.upsert(p.threadId, p.turnId, {...old, id: p.itemId, type: 'agentMessage',
        text: (old?.type === 'agentMessage' ? old.text : '') + p.delta} as ThreadItem, false);
    } else if (method === 'item/fileChange/patchUpdated') {
      const old = this.itemIndex.get(`${p.threadId}:${p.itemId}`)?.value;
      this.upsert(p.threadId, p.turnId, {type: 'fileChange', id: p.itemId, changes: p.changes,
        status: old?.type === 'fileChange' ? old.status : 'inProgress'}, false);
    } else if (method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') {
      const key = `Output ${p.itemId}`;
      this.detail(key, (this.state.details.get(key) ?? '') + p.delta);
    } else if (method === 'item/plan/delta' || method.startsWith('item/reasoning/')) {
      const key = `${method} ${p.itemId}`;
      this.detail(key, (this.state.details.get(key) ?? '') + (p.delta ?? ''));
    } else if (method === 'serverRequest/resolved') {
      this.state.prompts = this.state.prompts.filter(prompt => prompt.id !== p.requestId);
    } else if (method === 'error') {
      this.alert(`${p.willRetry ? 'Codex is retrying: ' : ''}${p.error?.message ?? JSON.stringify(p)}`);
    } else if (['warning', 'configWarning', 'guardianWarning', 'deprecationNotice', 'thread/realtime/error'].includes(method)) {
      const message = p.message ?? p.summary ?? JSON.stringify(p);
      // This protocol version provides these informational approvals as warning text.
      const approved = (method === 'guardianWarning' || method === 'warning')
        && /^Automatic approval review approved \(risk: [^)]+\):/.test(message);
      if (approved) this.detail(`Approval ${this.state.details.size}`, message);
      else {this.alert(message); this.detail(method, JSON.stringify(p, null, 2));}
    } else if (method === 'model/rerouted') {
      this.alert(`Model changed: ${p.toModel ?? JSON.stringify(p)}`);
      if (p.toModel) this.state.model = p.toModel;
    } else {
      this.detail(`${method} ${p.itemId ?? p.threadId ?? ''}`, JSON.stringify(p, null, 2));
    }
    this.changed();
  }

  private serverRequest(event: ServerMessage): void {
    if (event.method === 'currentTime/read') {
      this.rpc.respond(event.id!, {currentTimeAt: Math.floor(Date.now() / 1000)});
      return;
    }
    const item = this.itemIndex.get(`${event.params.threadId}:${event.params.itemId}`)?.value;
    const prompt = makePrompt(event, item);
    if (!prompt) {
      this.rpc.reject(event.id!, `Hush does not support ${event.method}.`);
      this.alert(`Unsupported Codex request: ${event.method}. No action was approved.`);
    } else if (!this.state.prompts.some(existing => existing.id === prompt.id)) this.state.prompts.push(prompt);
    this.changed();
  }

  respond(id: Id, result: unknown, revision = 0): void {
    if (!this.state.prompts.some(prompt => prompt.id === id && prompt.revision === revision)) return;
    this.rpc.respond(id, result);
    this.state.prompts = this.state.prompts.filter(prompt => prompt.id !== id);
    this.changed();
  }

  async rename(name: string): Promise<void> {
    const value = name.trim();
    if (!value) throw new Error('Usage: /rename My session name');
    if (this.state.phase !== 'ready' || !this.state.threadId) throw new Error('Open a session before renaming it.');
    const threadId = this.state.threadId;
    await this.rpc.request('thread/name/set', {threadId, name: value});
    this.ensureConnected();
    if (this.state.threadId === threadId) this.state.name = value;
    this.state.sessions = this.state.sessions.map(thread => thread.id === threadId ? {...thread, name: value} : thread);
    this.changed();
  }

  /** A send is never retried automatically; retain the draft in the UI on failure. */
  async send(text: string): Promise<boolean> {
    if (this.state.phase !== 'ready' || !this.state.threadId || this.state.sending || this.state.interrupting) return false;
    this.state.sending = true;
    this.changed();
    const clientId = randomUUID();
    const input = [{type: 'text' as const, text, text_elements: []}];
    this.upsert(this.state.threadId, this.state.activeTurn ?? '', {type: 'userMessage', id: `pending:${clientId}`, clientId: null, content: input}, true, true);
    this.changed();
    try {
      if (this.state.activeTurn) await this.rpc.request('turn/steer', {threadId: this.state.threadId,
        expectedTurnId: this.state.activeTurn, input, clientUserMessageId: clientId});
      else {
        const response = await this.rpc.request('turn/start', {threadId: this.state.threadId, input, clientUserMessageId: clientId});
        if (!this.completedTurns.has(response.turn.id)) this.state.activeTurn = response.turn.id;
        if (this.interruptPending && this.state.activeTurn) {this.state.interrupting = false; void this.interrupt();}
      }
      return true;
    } catch (error) {
      this.state.items = this.state.items.filter(item => item.value.id !== `pending:${clientId}`);
      this.itemIndex.delete(`${this.state.threadId}:pending:${clientId}`);
      this.alert((error as Error).message);
      return false;
    } finally {
      this.state.sending = false;
      if (this.interruptPending && !this.state.activeTurn) {this.interruptPending = false; this.state.interrupting = false;}
      this.changed();
    }
  }

  async interrupt(): Promise<void> {
    if (!this.state.threadId || this.state.interrupting) return;
    if (!this.state.activeTurn) {
      if (this.state.sending) {this.interruptPending = true; this.state.interrupting = true; this.changed();}
      return;
    }
    this.interruptPending = false;
    this.state.interrupting = true;
    this.changed();
    try { await this.rpc.request('turn/interrupt', {threadId: this.state.threadId, turnId: this.state.activeTurn}); }
    catch (error) { this.state.interrupting = false; this.alert((error as Error).message); }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    // Give Codex a chance to persist interruption before terminating its private process.
    let timer: NodeJS.Timeout | undefined;
    try {
      if (this.state.activeTurn && this.state.threadId) await Promise.race([
        this.rpc.request('turn/interrupt', {threadId: this.state.threadId, turnId: this.state.activeTurn}),
        new Promise<void>(resolve => {timer = setTimeout(resolve, 1000);}),
      ]);
    } catch { /* The process may already have exited; shutdown still completes. */ }
    finally {clearTimeout(timer); await this.rpc.close();}
  }
}
