<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowUp, ArrowUpRight, BookOpen, ShieldCheck } from '@lucide/vue';
import { resolveApiUrl } from '../api/networks';
import { api, friendlyError } from '../api/client';
import { appendMessage, historyKey, readHistory, type HelpMessage } from '../help/history';
import { useWorkspace } from '../state/workspace';
const state = useWorkspace();
const emit = defineEmits<{ ready: [] }>();
const configured = ref<boolean>(),
  question = ref(''),
  busy = ref(false),
  error = ref('');
const messages = ref<HelpMessage[]>([]),
  transcript = ref<HTMLElement>(),
  questionInput = ref<HTMLTextAreaElement>(),
  retryQuestion = ref(''),
  confirmClear = ref(false),
  clearButton = ref<HTMLButtonElement>(),
  confirmButton = ref<HTMLButtonElement>();
const suggestions = [
  'What is a DAO?',
  'How are Telos Zero and EVM different?',
  'How do I pair my wallet?',
];
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
async function clearHistory() {
  if (busy.value) generation++;
  busy.value = false;
  messages.value = [];
  if (configured.value === true) error.value = '';
  retryQuestion.value = '';
  confirmClear.value = false;
  save();
  await nextTick();
  questionInput.value?.focus();
}
async function toggleClearConfirmation(value: boolean) {
  confirmClear.value = value;
  await nextTick();
  (value ? confirmButton.value : clearButton.value)?.focus();
}
async function checkAvailability() {
  const request = ++generation;
  configured.value = undefined;
  error.value = '';
  try {
    const status = await api.docsAgent();
    if (disposed || request !== generation) return;
    configured.value = status.configured;
    await nextTick();
    scrollTranscript();
    emit('ready');
  } catch (cause) {
    if (!disposed && request === generation) error.value = friendlyError(cause);
  }
}
watch(
  scope,
  () => {
    question.value = '';
    error.value = '';
    busy.value = false;
    retryQuestion.value = '';
    confirmClear.value = false;
    try {
      messages.value = readHistory(localStorage.getItem(scope()));
    } catch {
      messages.value = [];
    }
    void checkAvailability();
  },
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
function scrollTranscript() {
  transcript.value?.scrollTo({ top: messages.value.length ? transcript.value.scrollHeight : 0 });
}
watch(
  messages,
  async () => {
    await nextTick();
    scrollTranscript();
  },
  { immediate: true },
);
async function selectSuggestion(text: string) {
  question.value = text;
  await nextTick();
  questionInput.value?.focus();
}
function submitShortcut(event: KeyboardEvent) {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
  event.preventDefault();
  void ask();
}
async function ask(text = question.value.trim(), retry = false) {
  if (busy.value || configured.value !== true || text.length < 2 || text.length > 500) return;
  const request = ++generation,
    context = scope();
  busy.value = true;
  error.value = '';
  retryQuestion.value = '';
  confirmClear.value = false;
  if (!retry) {
    question.value = '';
    messages.value = appendMessage(messages.value, { role: 'user', text });
    save();
  }
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
    if (!disposed && request === generation) {
      error.value = friendlyError(cause);
      retryQuestion.value = text;
    }
  } finally {
    if (request === generation) busy.value = false;
  }
}
</script>
<template>
  <section class="docs-assistant" aria-label="Daxi assistant">
    <div ref="transcript" class="help-transcript">
      <div v-if="!messages.length" class="help-welcome">
        <h2>What can I help you with?</h2>
        <p>I'm Daxi. Ask me about Daclify, Telos or DAOs.</p>
        <div v-if="configured === true" class="help-suggestions" aria-label="Suggested questions">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            type="button"
            class="secondary"
            @click="selectSuggestion(suggestion)"
          >
            <span>{{ suggestion }}</span
            ><ArrowUpRight aria-hidden="true" />
          </button>
        </div>
      </div>
      <div class="help-conversation" role="log" aria-label="Help conversation" aria-live="polite">
        <article
          v-for="(message, index) in messages"
          :key="index"
          class="help-message"
          :class="message.role"
        >
          <strong>{{ message.role === 'user' ? 'You' : 'Daxi Help' }}</strong>
          <p>{{ message.text }}</p>
          <RouterLink v-if="message.topicId" :to="`/docs/${message.topicId}`" class="help-source"
            ><BookOpen aria-hidden="true" :size="16" /><span>Open {{ message.title }}</span
            ><ArrowUpRight aria-hidden="true" :size="16"
          /></RouterLink>
        </article>
        <p v-if="busy" class="help-thinking" role="status">Daxi is checking the guides…</p>
      </div>
      <div v-if="error" class="help-error alert" role="alert">
        <p>{{ error }}</p>
        <button
          v-if="retryQuestion"
          type="button"
          class="secondary"
          @click="ask(retryQuestion, true)"
        >
          Retry answer
        </button>
        <button
          v-else-if="configured === undefined"
          type="button"
          class="secondary"
          @click="checkAvailability"
        >
          Retry connection
        </button>
      </div>
      <p v-if="configured === undefined && !error" class="notice" role="status">Checking Daxi…</p>
      <p v-else-if="configured === false" class="notice">Daxi is not configured on this server.</p>
    </div>
    <form v-if="configured === true" class="help-composer" @submit.prevent="ask()">
      <label for="docs-question" class="sr-only">Question</label
      ><textarea
        id="docs-question"
        ref="questionInput"
        v-model="question"
        maxlength="500"
        rows="2"
        required
        placeholder="Ask a question…"
        aria-describedby="help-privacy help-shortcut"
        @keydown="submitShortcut"
      />
      <div class="help-composer-actions">
        <small id="help-shortcut">Ctrl / ⌘ + Enter to ask</small>
        <button type="submit" :disabled="busy || question.trim().length < 2">
          <ArrowUp aria-hidden="true" />{{ busy ? 'Asking…' : 'Ask' }}
        </button>
      </div>
    </form>
    <footer class="help-footer">
      <p id="help-privacy" class="help-privacy">
        <ShieldCheck aria-hidden="true" :size="14" />Do not include secrets or private content.
      </p>
      <div class="help-footer-actions">
        <RouterLink to="/docs">Browse guides</RouterLink>
        <button
          v-if="messages.length && !confirmClear"
          ref="clearButton"
          type="button"
          class="text-button"
          @click="toggleClearConfirmation(true)"
        >
          Clear conversation
        </button>
      </div>
      <div
        v-if="confirmClear"
        class="help-clear-confirmation"
        role="group"
        aria-label="Confirm clearing conversation"
      >
        <p>Clear this conversation from this browser?</p>
        <div class="button-row">
          <button ref="confirmButton" type="button" class="secondary danger" @click="clearHistory">
            Confirm clear
          </button>
          <button type="button" class="secondary" @click="toggleClearConfirmation(false)">
            Cancel
          </button>
        </div>
      </div>
      <details class="help-about">
        <summary>About Daxi &amp; this conversation</summary>
        <p>
          I cannot see your vault or live DAO records. AI can make mistakes; review the linked
          guide.
        </p>
        <p>
          Last 100 messages stay in this browser, separately for each account and network. Each
          answer uses your current question.
        </p>
      </details>
    </footer>
  </section>
</template>
