
export function parseChatPayload(payload: ChatPayload): ChatMessage {
  const { text, voiceDirective: voiceMode } = payload;
  return { text, voiceDirective: voiceMode };
}
