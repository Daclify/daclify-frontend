<script setup lang="ts">
import type { HelpBundle } from '@daclify/core-protocol';
defineProps<{ bundles: ReadonlyArray<HelpBundle> }>();
function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}
</script>
<template>
  <p class="field-help">
    Generated fields and JSON Schema describe structure. The matching guides, runtime validators and
    contract rules also apply. Source ABI hashes below hash the ABI JSON bytes, not Antelope's
    encoded ABI.
  </p>
  <section v-for="bundle in bundles" :key="bundle.producer">
    <h3>{{ bundle.producer === 'core' ? 'Core' : 'Modules' }} v{{ bundle.packageVersion }}</h3>
    <details v-for="contract in bundle.contracts" :key="contract.name" class="reference-details">
      <summary>{{ contract.name }} contract reference</summary>
      <p class="mono wrap">Source ABI JSON SHA-256: {{ contract.sourceAbiHash }}</p>
      <div
        v-for="group in [
          { label: 'Action', entries: contract.actions },
          { label: 'Table', entries: contract.tables },
        ]"
        :key="group.label"
      >
        <details v-for="entry in group.entries" :key="entry.name" class="reference-details">
          <summary>{{ group.label }}: {{ entry.name }}</summary>
          <div class="reference-scroll">
            <table>
              <caption class="sr-only">
                {{
                  contract.name
                }}
                {{
                  entry.name
                }}
                fields
              </caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">ABI type</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="field in entry.fields" :key="field.name">
                  <td>{{ field.name }}</td>
                  <td class="mono">{{ field.type }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!entry.fields.length">This entry has no fields.</p>
        </details>
      </div>
    </details>
    <details
      v-for="endpoint in bundle.api"
      :key="`${endpoint.method}:${endpoint.path}`"
      class="reference-details"
    >
      <summary>{{ endpoint.method }} {{ endpoint.path }}</summary>
      <template v-if="endpoint.input !== undefined"
        ><h4>Request schema</h4>
        <pre class="wrap">{{ json(endpoint.input) }}</pre>
      </template>
      <template v-if="endpoint.query !== undefined"
        ><h4>Query schema</h4>
        <pre class="wrap">{{ json(endpoint.query) }}</pre>
      </template>
      <p v-if="endpoint.status">
        HTTP {{ endpoint.status }}{{ endpoint.status === 204 ? ' · no response body' : '' }}
      </p>
      <h4>Response schema</h4>
      <pre class="wrap">{{ json(endpoint.response) }}</pre>
    </details>
    <details v-for="module in bundle.modules" :key="module.manifest.id" class="reference-details">
      <summary>{{ module.manifest.id }} configuration · v{{ module.manifest.version }}</summary>
      <p>
        Core compatibility: {{ module.manifest.coreRange }} · Configuration version
        {{ module.manifest.configVersion }}
      </p>
      <p>Capabilities: {{ module.manifest.capabilities.join(', ') }}</p>
      <pre class="wrap">{{ json(module.configuration) }}</pre>
    </details>
  </section>
</template>
