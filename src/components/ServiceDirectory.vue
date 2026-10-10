<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PlatformStatus } from '@daclify/core-protocol';
const props = defineProps<{ services: PlatformStatus['services'] }>();
const emit = defineEmits<{ help: [] }>();
const search = ref(''),
  readiness = ref('all');
const categories = [
  {
    title: 'Sign-in and accounts',
    ids: ['google', 'telegram', 'managed'],
    description: 'Open your service account. DAO permissions and private keys remain separate.',
    to: '/account',
    action: 'Sign-in options',
  },
  {
    title: 'Payments and hosting',
    ids: ['card', 'card-ram', 'hosting', 'connect'],
    description: 'Card checkout, blockchain resources and DAO subscriptions.',
    to: '/docs/payments',
    action: 'Payment guide',
  },
  {
    title: 'Files and storage',
    ids: ['storage', 'storage-retention', 'storage-notices', 'storage-alerts', 'storage-billing'],
    description: 'Store documents and manage capacity, reminders and retention.',
    to: '/docs/resources-and-retention',
    action: 'Storage guide',
  },
  {
    title: 'Help and learning',
    ids: ['docs', 'telegram-docs'],
    description: 'Daxi in the app and approved Telegram chats.',
    to: '/docs/docs-assistant',
    action: 'Daxi guide',
  },
  {
    title: 'Other services',
    ids: [],
    description: 'Additional integrations reported by this deployment.',
    to: '/docs',
    action: 'Open documentation',
  },
];
const groups = computed(() =>
  categories
    .map((category) => ({
      ...category,
      services: props.services.filter(
        (service) =>
          (category.ids.length
            ? category.ids.includes(service.id)
            : !categories.some((group) => group.ids.includes(service.id))) &&
          (readiness.value === 'all' ||
            (readiness.value === 'configured' ? service.configured : !service.configured)) &&
          [service.name, category.title]
            .join(' ')
            .toLowerCase()
            .includes(search.value.trim().toLowerCase()),
      ),
    }))
    .filter((group) => group.services.length),
);
const shown = computed(() =>
  groups.value.reduce((count, group) => count + group.services.length, 0),
);
function clear() {
  search.value = '';
  readiness.value = 'all';
}
</script>
<template>
  <div class="service-filters">
    <label for="service-search"
      >Search services<input
        id="service-search"
        v-model="search"
        type="search"
        placeholder="Service or purpose"
    /></label>
    <label for="service-readiness"
      ><span>Service readiness</span
      ><select id="service-readiness" v-model="readiness" aria-label="Service readiness">
        <option value="all">All services</option>
        <option value="configured">Configured</option>
        <option value="missing">Not configured</option>
      </select></label
    >
  </div>
  <div class="service-results">
    <p class="field-help" role="status">{{ shown }} of {{ services.length }} services shown</p>
    <button v-if="search || readiness !== 'all'" type="button" class="text-button" @click="clear">
      Clear service filters
    </button>
  </div>
  <section v-for="group in groups" :key="group.title" class="service-group">
    <div class="service-group-heading">
      <div>
        <h3>{{ group.title }}</h3>
        <p class="field-help">{{ group.description }}</p>
      </div>
      <RouterLink :to="group.to">{{ group.action }} →</RouterLink>
    </div>
    <div class="service-list">
      <article v-for="service in group.services" :key="service.id" class="service-item">
        <div class="service-item-heading">
          <h4>{{ service.name }}</h4>
          <span class="pill">{{ service.configured ? 'Configured' : 'Not configured' }}</span>
        </div>
        <details>
          <summary>Setup and verification details</summary>
          <p class="field-help">
            {{
              service.configured
                ? 'Settings are present. A live check is still required.'
                : 'This deployment needs operator setup before you can use this service.'
            }}
          </p>
          <p>{{ service.detail }}</p>
          <p class="field-help">
            {{
              service.qualification === 'local-fixture'
                ? 'Local fixture only · live availability unverified'
                : 'Live availability unverified'
            }}
          </p>
        </details>
      </article>
    </div>
  </section>
  <div v-if="!shown" class="empty-state">
    <p>
      {{
        services.length
          ? 'No services match these filters.'
          : 'No other integrations reported by this server.'
      }}
    </p>
    <button v-if="services.length" type="button" class="secondary" @click="clear">
      Show all services
    </button>
  </div>
  <button type="button" class="text-button" @click="emit('help')">
    Daxi configuration <span aria-hidden="true">→</span>
  </button>
</template>
<style scoped>
.service-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(10rem, 14rem);
  gap: 1rem;
}
.service-filters input,
.service-filters select {
  margin-bottom: 0;
}
.service-results,
.service-group-heading,
.service-item-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.service-results p {
  margin: 0.75rem 0;
}
.service-group {
  margin: 1.5rem 0;
}
.service-group h3 {
  margin: 0;
}
.service-group-heading p {
  margin: 0.5rem 0 1rem;
  max-width: 40rem;
}
.service-group-heading a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.service-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
.service-item {
  border: 1px solid var(--border-default);
  border-radius: 0.75rem;
  padding: 1rem;
  min-width: 0;
}
.service-item h4 {
  font-size: 1rem;
  margin: 0;
}
.service-item summary {
  min-height: 44px;
  padding-block: 0.75rem;
  font-size: 0.875rem;
}
.service-item p {
  overflow-wrap: anywhere;
}
.service-item .pill {
  font-size: 0.75rem;
}
@media (max-width: 45rem) {
  .service-filters,
  .service-list {
    grid-template-columns: 1fr;
  }
}
</style>
