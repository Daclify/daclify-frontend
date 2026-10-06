<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, friendlyError } from '../api/client';

const configured = ref<boolean>();
const question = ref('');
const busy = ref(false);
const error = ref('');
const answer = ref('');
const topicId = ref<string>();
const topicTitle = ref<string>();
onMounted(() => {
  void api
    .docsAgent()
    .then((status) => {
      configured.value = status.configured;
    })
    .catch((cause: unknown) => {
      error.value = friendlyError(cause);
    });
});
async function ask() {
  busy.value = true;
  error.value = '';
  answer.value = '';
  topicId.value = undefined;
  topicTitle.value = undefined;
  try {
    const result = await api.askDocs(question.value);
    answer.value = result.answer;
    if (result.topicId && result.title) {
      topicId.value = result.topicId;
      topicTitle.value = result.title;
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="panel docs-assistant" aria-label="Handbook assistant">
    <h2>Ask the handbook</h2>
    <p class="field-help">
      A decision model picks one guide, then a language model answers from that guide. It does not
      see your vault, balances, or DAO records.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="configured === undefined && !error" role="status">Checking the handbook assistant…</p>
    <p v-else-if="!configured" class="notice">
      The documentation assistant is not configured on this server.
    </p>
    <form v-else @submit.prevent="ask">
      <label for="docs-question">Question</label>
      <textarea
        id="docs-question"
        v-model="question"
        maxlength="500"
        rows="3"
        required
        placeholder="How does recovery work?"
      ></textarea>
      <button :disabled="busy || question.trim().length < 2">
        {{ busy ? 'Asking…' : 'Ask' }}
      </button>
    </form>
    <p v-if="answer" class="docs-answer" role="status">{{ answer }}</p>
    <RouterLink v-if="topicId" :to="`/docs/${topicId}`">Open {{ topicTitle }}</RouterLink>
  </section>
</template>
