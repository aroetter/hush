/** A deterministic JSONL peer used to test transport behavior and the terminal executable. */
import {createInterface} from 'node:readline';
const mode = process.argv[2] ?? 'echo';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
if (process.argv.includes('--version')) {console.log('codex-cli 0.160.1'); process.exit(0);}
const lines = createInterface({input: process.stdin});
let sequence = 0;
let latestTurn = 'turn0';
lines.on('line', line => {
  const message = JSON.parse(line);
  if (!message.method) {
    if (mode === 'ui') {
      send({method: 'item/completed', params: {threadId: 'root', turnId: latestTurn, item: {id: `answer_${sequence}`, type: 'agentMessage', phase: 'final_answer', text: 'Approval received. All done.'}}});
      send({method: 'turn/completed', params: {threadId: 'root', turn: {id: latestTurn, status: 'completed'}}});
    }
    return;
  }
  if (message.id === undefined) return;
  if (mode === 'malformed') {process.stdout.write('not-json\n'); return;}
  if (mode === 'exit') {process.exit(7);}
  if (mode === 'timeout') return;
  if (mode === 'echo') {
    process.stderr.write('diagnostic log\n');
    send({id: 'approval', method: 'approve/test', params: {command: 'demo'}});
    send({method: 'test/event', params: {ok: true}});
    setTimeout(() => send({id: message.id, result: {echo: message.params}}), message.params?.delay ?? 0);
    return;
  }
  const thread = {id: 'root', turns: [], name: 'Saved smoke conversation', preview: 'Saved smoke conversation', updatedAt: 1234567890, cwd: process.cwd()};
  if (message.method === 'initialize') send({id: message.id, result: {}});
  else if (message.method === 'thread/start' || message.method === 'thread/resume') send({id: message.id, result: {thread, model: 'test-model'}});
  else if (message.method === 'thread/list') send({id: message.id, result: {data: [thread], nextCursor: null}});
  else if (message.method === 'thread/turns/list') send({id: message.id, result: {data: [{id: 'old', status: 'completed', itemsView: 'full', items: [{type: 'agentMessage', id: 'old-answer', phase: 'final_answer', text: 'Previous saved answer.'}]}], nextCursor: null}});
  else if (message.method === 'turn/start' || message.method === 'turn/steer') {
    latestTurn = `turn${++sequence}`;
    send({id: message.id, result: {turn: {id: latestTurn}, turnId: latestTurn}});
    send({method: 'turn/started', params: {threadId: 'root', turn: {id: latestTurn}}});
    send({method: 'item/completed', params: {threadId: 'root', turnId: latestTurn, item: {type: 'userMessage', id: `user_${sequence}`, clientId: message.params.clientUserMessageId, content: message.params.input}}});
    send({method: 'item/completed', params: {threadId: 'root', turnId: latestTurn, item: {type: 'agentMessage', id: `progress_${sequence}`, phase: 'commentary', text: 'Inspecting files'}}});
    send({method: 'item/started', params: {threadId: 'root', turnId: latestTurn, item: {type: 'commandExecution', id: `cmd_${sequence}`, command: 'hidden-command-for-test', cwd: process.cwd(), status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null}}});
    if (message.params.input[0].text === 'approval') send({id: 99, method: 'item/commandExecution/requestApproval', params: {threadId: 'root', turnId: latestTurn, command: 'review-this-command', availableDecisions: ['accept', 'decline']}});
    else if (message.params.input[0].text !== 'wait') {
      send({method: 'item/completed', params: {threadId: 'root', turnId: latestTurn, item: {id: `answer_${sequence}`, type: 'agentMessage', phase: 'final_answer', text: 'Visible test answer.'}}});
      send({method: 'turn/completed', params: {threadId: 'root', turn: {id: latestTurn, status: 'completed'}}});
    }
  } else if (message.method === 'turn/interrupt') {
    send({id: message.id, result: {}});
    send({method: 'turn/completed', params: {threadId: 'root', turn: {id: latestTurn, status: 'interrupted'}}});
  } else send({id: message.id, error: {code: -32601, message: 'Unknown method'}});
});
