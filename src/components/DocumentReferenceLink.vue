<script setup lang="ts">
import { computed } from 'vue';
import { documentReferenceLocation } from '../content/document-reference';

const props=withDefaults(defineProps<{daoId:string;documentId:string;version:number;commitment?:string|undefined;returnTo?:string|undefined;label?:string}>(),{label:'Review document'});
const location=computed(()=>documentReferenceLocation(props));
</script>
<template>
  <RouterLink v-if="location" :to="location">{{label}} · version {{version}}</RouterLink>
  <span v-else class="muted">{{label}} · version {{version}} unavailable</span>
</template>
