<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Clock3 } from '@lucide/vue';
import { activityText } from '../state/public-people';
defineProps<{ lastActive: number | null }>();
const now = ref(Math.floor(Date.now() / 1000));
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => {
    now.value = Math.floor(Date.now() / 1000);
  }, 60000);
});
onBeforeUnmount(() => {
  clearInterval(timer);
});
</script>
<template>
  <small class="dao-activity"
    ><Clock3 aria-hidden="true" />
    <time
      v-if="lastActive !== null"
      :datetime="new Date(lastActive * 1000).toISOString()"
      :title="new Date(lastActive * 1000).toLocaleString()"
      >{{ activityText(lastActive, now) }}</time
    >
    <span v-else>{{ activityText(null, now) }}</span>
  </small>
</template>
<style scoped>
.dao-activity {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted);
  font-size: 0.8rem;
}
.dao-activity svg {
  width: 14px;
  height: 14px;
  flex: none;
}
</style>
