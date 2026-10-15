/** Async questions remain reviewable until explicitly answered through the question panel. */
import type {State} from './session.js';
export interface PendingQuestion {id: string; title: string; options: string[]}
export const questionReply = (question: PendingQuestion, answer: string): string =>
  `In reply to your question "${question.title}":\n${answer}`;

export function pendingQuestions(state: State): PendingQuestion[] {
  const pending: PendingQuestion[] = [];
  for (const item of state.items) {
    if (item.threadId !== state.threadId) continue;
    const v = item.value;
    if (v.type === 'agentMessage') {
      for (const [index, q] of (v.questions ?? []).entries()) {
        pending.push({id: `${v.id}:${index}`, title: q.title, options: q.options ?? []});
      }
    } else if (v.type === 'userMessage' && !v.id.startsWith('pending:')) {
      const text = v.content.filter(input => input.type === 'text').map(input => input.text).join('\n');
      for (let i = pending.length - 1; i >= 0; i--) {
        if (text.startsWith(questionReply(pending[i]!, ''))) pending.splice(i, 1);
      }
    }
  }
  return pending;
}
