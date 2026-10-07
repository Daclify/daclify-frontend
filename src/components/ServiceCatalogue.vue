<script setup lang="ts">
import { computed, ref } from 'vue';
import { ServiceOfferDocumentSchema } from '@daclify/modules';
import type { DaoContent, DaoRef } from '@daclify/core-protocol';
const props = defineProps<{ content: DaoContent | undefined; dao: DaoRef; canPropose: boolean }>(),
  emit = defineEmits<{ choose: [member: string] }>();
const query = ref('');
const offers = computed(() => {
  const latest = new Map<string, NonNullable<typeof props.content>['documents'][number]>();
  for (const doc of props.content?.documents ?? [])
    if (!latest.has(doc.document_id) || doc.version > (latest.get(doc.document_id)?.version ?? 0))
      latest.set(doc.document_id, doc);
  return [...latest.values()].flatMap((doc) => {
    if (doc.cid || doc.envelope_version !== 0) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(doc.metadata);
    } catch {
      return [];
    }
    const result = ServiceOfferDocumentSchema.safeParse(raw);
    if (
      !result.success ||
      result.data.memberId !== doc.author ||
      JSON.stringify(result.data.dao) !== JSON.stringify(props.dao) ||
      !props.content?.members.some((m) => m.id === doc.author && m.active)
    )
      return [];
    const offer = result.data;
    return `${offer.title} ${offer.summary} ${offer.skills.join(' ')}`
      .toLocaleLowerCase()
      .includes(query.value.toLocaleLowerCase())
      ? [{ ...offer, document: doc.document_id }]
      : [];
  });
});
</script>
<template>
  <details class="panel">
    <summary>Member service catalogue</summary>
    <p>
      Find member offers and start a Works proposal. A service listing holds no funds and grants no
      roles. Publish a version 1 service-offer document to list a service.
    </p>
    <label for="service-search">Search member services</label
    ><input id="service-search" v-model="query" type="search" />
    <p v-if="!offers.length" class="muted">
      No matching public offers. Private narratives remain in Documents.
    </p>
    <article v-for="offer in offers" :key="offer.document">
      <h3>{{ offer.title }}</h3>
      <p>{{ offer.summary }}</p>
      <p>Member {{ offer.memberId }} · {{ offer.skills.join(', ') }}</p>
      <button
        type="button"
        class="secondary"
        :disabled="!canPropose"
        @click="emit('choose', offer.memberId)"
      >
        Propose work with this member
      </button>
    </article>
    <RouterLink to="/docs/contribution-agreements" class="help-link"
      >Agreement and service templates ↗</RouterLink
    >
  </details>
</template>
