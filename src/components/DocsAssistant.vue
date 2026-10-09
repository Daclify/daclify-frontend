<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { resolveApiUrl } from '../api/networks';
import { api, friendlyError } from '../api/client';
import { appendMessage, historyKey, readHistory, type HelpMessage } from '../help/history';
import { useWorkspace } from '../state/workspace';
const state = useWorkspace();
const configured = ref<boolean>(),
  question = ref(''),
  busy = ref(false),
  error = ref('');
const messages = ref<HelpMessage[]>([]),
  transcript = ref<HTMLElement>();
let generation = 0,
  disposed = false;
const scope = () =>
  historyKey(
    JSON.stringify([resolveApiUrl('/'), state.network?.chainId, state.network?.runtime]),
    state.account?.id,
  );
function save() {
  try {
    localStorage.setItem(scope(), JSON.stringify(messages.value));
  } catch {
    /* Chat remains usable when browser storage is unavailable. */
  }
}
function clearHistory() {
  generation++;
  busy.value = false;
  messages.value = [];
  error.value = '';
  save();
}
watch(
  scope,
  async () => {
    const request = ++generation;
    question.value = '';
    error.value = '';
    busy.value = false;
    configured.value = undefined;
    try {
      messages.value = readHistory(localStorage.getItem(scope()));
    } catch {
      messages.value = [];
    }
    try {
      const status = await api.docsAgent();
      if (!disposed && request === generation) configured.value = status.configured;
    } catch (cause) {
      if (!disposed && request === generation) error.value = friendlyError(cause);
    }
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    transcript.value?.scrollTo({ top: transcript.value.scrollHeight });
  },
);
async function ask() {
  if (busy.value || configured.value !== true || question.value.trim().length < 2) return;
  const text = question.value.trim(),
    request = ++generation,
    context = scope();
  busy.value = true;
  error.value = '';
  question.value = '';
  messages.value = appendMessage(messages.value, { role: 'user', text });
  save();
  try {
    const result = await api.askDocs(text);
    if (disposed || request !== generation || scope() !== context) return;
    messages.value = appendMessage(messages.value, {
      role: 'assistant',
      text: result.answer,
      ...(result.topicId && result.title ? { topicId: result.topicId, title: result.title } : {}),
    });
    save();
  } catch (cause) {
    if (!disposed && request === generation) error.value = friendlyError(cause);
  } finally {
    if (request === generation) busy.value = false;
  }
}
</script>
<template>
  <section class="docs-assistant" aria-label="Handbook assistant">
    <p class="field-help">
      Ask about Daclify or its documented setup. The assistant cannot see your vault or DAO records.
      Do not include secrets or private content. AI can make mistakes; review the linked guide.
    </p>
    <div
      ref="transcript"
      class="help-transcript"
      role="log"
      aria-label="Help conversation"
      aria-live="polite"
    >
      <article
        v-for="(message, index) in messages"
        :key="index"
        class="help-message"
        :class="message.role"
      >
        <strong>{{ message.role === 'user' ? 'You' : 'Daclify Help' }}</strong>
        <p>{{ message.text }}</p>
        <RouterLink v-if="message.topicId" :to="`/docs/${message.topicId}`"
          >Open {{ message.title }}</RouterLink
        >
      </article>
      <p v-if="!messages.length" class="muted">
        Try “How do I join a DAO?” or “How do I pair my wallet?”
      </p>
      <p v-if="busy" role="status">Checking the handbook…</p>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="configured === undefined && !error" role="status">Checking the handbook assistant…</p>
    <p v-else-if="configured === false" class="notice">
      The documentation assistant is not configured on this server.
    </p>
    <form v-else-if="configured === true" @submit.prevent="ask">
      <label for="docs-question">Question</label
      ><textarea
        id="docs-question"
        v-model="question"
        maxlength="500"
        rows="2"
        required
        placeholder="How can we help with Daclify?"
      />
      <div class="button-row">
        <button :disabled="busy || question.trim().length < 2">
          {{ busy ? 'Asking…' : 'Ask' }}</button
        ><button
          type="button"
          class="text-button"
          :disabled="!messages.length"
          @click="clearHistory"
        >
          Clear conversation
        </button>
      </div>
    </form>
    <small class="muted"
      >Last 100 messages stay in this browser, separately for each account and network. Each answer
      uses your current question.</small
    >
  </section>
</template>
