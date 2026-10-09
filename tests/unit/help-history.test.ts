import { describe, expect, it } from 'vitest';
import { readHistory, appendMessage, historyKey } from '../../src/help/history';
describe('browser help history', () => {
  it('retains the last 100 messages and rejects malformed persisted entries', () => {
    let messages = readHistory(null);
    for (let i = 0; i < 106; i++)
      messages = appendMessage(messages, { role: 'user', text: String(i) });
    expect(messages).toHaveLength(100);
    expect(messages[0]?.text).toBe('6');
    expect(readHistory('{"role":"admin"}')).toEqual([]);
    expect(
      readHistory(
        JSON.stringify([{ role: 'assistant', text: 'safe', topicId: 'javascript:alert(1)' }]),
      ),
    ).toEqual([]);
  });
  it('scopes account history to its network and service', () => {
    expect(historyKey('a', 'alice')).not.toBe(historyKey('a', 'bob'));
    expect(historyKey('a', 'alice')).not.toBe(historyKey('b', 'alice'));
    expect(historyKey('a', undefined)).toContain('visitor');
  });
  it('keeps canonical guide IDs containing release dots', () => {
    expect(
      appendMessage([], {
        role: 'assistant',
        text: 'Release guide',
        topicId: 'release-0.5',
        title: 'Release 0.5',
      }),
    ).toHaveLength(1);
  });
});
