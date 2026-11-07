import type { AppState, ChatReply } from './types';
export interface CompletedReply {
  characterId: string;
  reply: ChatReply;
  messageId: string;
  memoryId: string;
  replyTo?: string;
  createdAt: string;
}
export function appendCompletedReply(state: AppState, completed: CompletedReply): AppState {
  const { characterId, reply, messageId, memoryId, createdAt } = completed;
  const history = state.messages[characterId] || [];
  const hasMemory = state.memories.some(
    (memory) => memory.characterId === characterId && memory.text === reply.memory,
  );
  return {
    ...state,
    messages: {
      ...state.messages,
      [characterId]: history.some((message) => message.id === messageId)
        ? history
        : [
            ...history,
            {
              id: messageId,
              role: 'assistant' as const,
              content: reply.text,
              emotion: reply.emotion,
              action: reply.action,
              ...(reply.origin ? { origin: reply.origin } : {}),
              ...(reply.interaction ? { interaction: reply.interaction } : {}),
              ...(completed.replyTo ? { replyTo: completed.replyTo } : {}),
              createdAt,
            },
          ],
    },
    memories:
      reply.memory && !hasMemory && state.memories.length < 5000
        ? [...state.memories, { id: memoryId, characterId, text: reply.memory, createdAt }]
        : state.memories,
  };
}
