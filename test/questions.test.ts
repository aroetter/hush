import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingQuestions, questionReply} from '../src/questions.js';
import {ready, item, agent} from './helpers.js';

test('saved explicit answers resolve only their question; other chat does not infer consent', async () => {
  const {rpc, session} = await ready();
  item(rpc, {...agent('questions', ''), questions: [{title: 'Spend $5?', options: ['Yes', 'No']}, {title: 'Publish?', options: ['Yes', 'No']}]});
  const questions = pendingQuestions(session.state);
  item(rpc, {type: 'userMessage', id: 'unrelated', content: [{type: 'text', text: 'yes keep working'}]});
  assert.equal(pendingQuestions(session.state).length, 2);
  item(rpc, {type: 'userMessage', id: 'answer', content: [{type: 'text', text: questionReply(questions[1]!, 'No')}]});
  assert.deepEqual(pendingQuestions(session.state).map(q => q.title), ['Spend $5?']);
});
