/** Deterministic in-memory app-server interface for workflow tests. */
import {EventEmitter} from 'node:events';
import type {Connection, Id} from '../src/rpc.js';
import {Session} from '../src/session.js';
import {parseOptions} from '../src/args.js';

export class FakeConnection extends EventEmitter implements Connection {
  calls: {method: string; params: any}[] = [];
  replies: {id: Id; result?: unknown; error?: string}[] = [];
  handler: (method: string, params: any) => Promise<any> = async method => {
    if (method === 'initialize') return {};
    if (method === 'thread/start' || method === 'thread/resume') return {thread: {id: 'root', turns: []}, model: 'test-model'};
    if (method === 'thread/list') return {data: [], nextCursor: null};
    if (method === 'thread/turns/list') return {data: [], nextCursor: null};
    if (method === 'turn/start') return {turn: {id: 'turn-1'}};
    return {};
  };
  async request(method: any, params: any): Promise<any> {this.calls.push({method, params}); return this.handler(method, params);}
  notify(method: string, params?: unknown): void {this.calls.push({method, params});}
  respond(id: Id, result: unknown): void {this.replies.push({id, result});}
  reject(id: Id, error: string): void {this.replies.push({id, error});}
  async close(): Promise<void> {}
  event(method: string, params: any): void {this.emit('notification', {method, params});}
  ask(id: Id, method: string, params: any): void {this.emit('request', {id, method, params});}
}
export async function ready(args: string[] = []): Promise<{rpc: FakeConnection; session: Session}> {
  const rpc = new FakeConnection();
  const session = new Session(rpc, parseOptions(args, '/project'));
  await session.start();
  return {rpc, session};
}
export function agent(id: string, text: string, phase = 'final_answer'): any {
  return {type: 'agentMessage', id, text, phase, questions: null, delivery: null};
}
export function item(rpc: FakeConnection, value: any, complete = true, threadId = 'root', turnId = 'turn-1'): void {
  rpc.event(complete ? 'item/completed' : 'item/started', {threadId, turnId, item: value});
}
