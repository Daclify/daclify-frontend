import { z } from 'zod';
import { HelpBundleSchema } from '@daclify/core-protocol';
const topic = HelpBundleSchema.shape.topics.element;
const MessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(24000),
  topicId: topic.shape.id.optional(),
  title: topic.shape.title.optional(),
});
export type HelpMessage = z.infer<typeof MessageSchema>;
export function readHistory(raw: string | null): HelpMessage[] {
  if (!raw || raw.length > 2500000) return [];
  try {
    return z.array(MessageSchema).max(100).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}
export function appendMessage(messages: HelpMessage[], message: HelpMessage): HelpMessage[] {
  return [...messages, MessageSchema.parse(message)].slice(-100);
}
export function historyKey(service: string, account: string | undefined): string {
  return `daclify.help.v1:${encodeURIComponent(service)}:${account ?? 'visitor'}`;
}
