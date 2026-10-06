/** Convert server requests into explicit choices; never infer consent from a timeout or default. */
import type {ServerMessage, Id} from './rpc.js';
import type {ThreadItem} from './protocol/v2/ThreadItem.js';
import type {ToolRequestUserInputQuestion} from './protocol/v2/ToolRequestUserInputQuestion.js';
import type {CommandExecutionRequestApprovalParams} from './protocol/v2/CommandExecutionRequestApprovalParams.js';
import type {PermissionsRequestApprovalParams} from './protocol/v2/PermissionsRequestApprovalParams.js';

export interface Prompt {
  id: Id;
  request: ServerMessage;
  revision: number;
  threadId: string;
  turnId?: string;
  title: string;
  body: string;
  choices: {label: string; result: unknown}[];
  questions?: ToolRequestUserInputQuestion[];
  form?: boolean;
}

export function makePrompt(request: ServerMessage, item?: ThreadItem): Prompt | undefined {
  const p = request.params;
  const base = {id: request.id!, request, revision: 0, threadId: p.threadId ?? p.conversationId, turnId: p.turnId};
  if (request.method === 'item/commandExecution/requestApproval') {
    const command = p as CommandExecutionRequestApprovalParams;
    const decisions = command.availableDecisions ?? ['accept', 'decline', 'cancel'];
    const labels: Record<string, string> = {accept: 'Allow once', acceptForSession: 'Allow for session', decline: 'Decline', cancel: 'Cancel turn'};
    return {...base, title: 'Command approval', body: JSON.stringify(command, null, 2), choices:
      decisions.map(decision => ({label: typeof decision === 'string' ? labels[decision] ?? decision : JSON.stringify(decision), result: {decision}}))};
  }
  if (request.method === 'item/fileChange/requestApproval') {
    const changes = item?.type === 'fileChange' ? item.changes : [];
    return {...base, title: 'File change approval',
      body: [p.reason, p.grantRoot ? `Requested write root: ${p.grantRoot}` : '',
        changes.length ? changes.map(c => `${c.path}\n${c.diff}`).join('\n\n') : 'Change details are unavailable. Approval is disabled.'].filter(Boolean).join('\n'),
      choices: [...(changes.length ? [{label: 'Allow once', result: {decision: 'accept'}}] : []),
        {label: 'Decline', result: {decision: 'decline'}}, {label: 'Cancel turn', result: {decision: 'cancel'}}]};
  }
  if (request.method === 'item/permissions/requestApproval') {
    const permissions = (p as PermissionsRequestApprovalParams).permissions;
    const granted = Object.fromEntries(Object.entries(permissions).filter(([, value]) => value != null));
    return {...base, title: 'Permission approval', body: JSON.stringify(p, null, 2), choices: [
      {label: 'Allow for this turn', result: {permissions: granted, scope: 'turn'}},
      {label: 'Decline', result: {permissions: {}, scope: 'turn'}},
    ]};
  }
  if (request.method === 'item/tool/requestUserInput') {
    if (!Array.isArray(p.questions) || !p.questions.length) return undefined;
    return {...base, title: 'Codex needs your answer', body: '', choices: [], questions: p.questions};
  }
  if (request.method === 'mcpServer/elicitation/request') {
    if (p.mode !== 'form' && p.mode !== 'url') return undefined;
    return {...base, title: `Request from ${p.serverName}`, form: p.mode === 'form',
      body: [p.message, p.url, p.requestedSchema ? `Enter a JSON object matching:\n${JSON.stringify(p.requestedSchema, null, 2)}` : 'Complete the URL interaction yourself, then confirm.'].filter(Boolean).join('\n'),
      choices: [
        ...(p.mode === 'url' ? [{label: 'Completed', result: {action: 'accept', content: null, _meta: null}}] : []),
        {label: 'Decline', result: {action: 'decline', content: null, _meta: null}},
        {label: 'Cancel', result: {action: 'cancel', content: null, _meta: null}},
      ]};
  }
  if (request.method === 'execCommandApproval' || request.method === 'applyPatchApproval') {
    return {...base, title: 'Codex approval', body: JSON.stringify(p, null, 2), choices: [
      {label: 'Allow once', result: {decision: 'approved'}},
      {label: 'Cancel', result: {decision: 'abort'}},
    ]};
  }
  return undefined;
}
