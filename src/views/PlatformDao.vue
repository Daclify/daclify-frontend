<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  parseUnits,
  formatUnits,
  DEFAULT_RESOURCE_POLICY,
  ResourcePolicySchema,
  type PlatformStatus,
} from '@daclify/core-protocol';
import {
  encodeAction,
  makeInstruction,
  RuntimeActionSchemas,
  RuntimeCodeHash,
} from '@daclify/core-protocol/sdk';
import { api, friendlyError } from '../api/client';
import { relayInstruction } from '../auth/session';
import { canSignMember } from '../auth/action-signer';
import ActionSigner from '../components/ActionSigner.vue';
const signerReady = computed(() => canSignMember(member.value));
import { useWorkspace } from '../state/workspace';
const workspace = useWorkspace();
const status = ref<PlatformStatus>(),
  catalogue = ref<Awaited<ReturnType<typeof api.marketplace>>>();
const error = ref(''),
  success = ref(''),
  busy = ref(false);
const freeSlots = ref(10),
  settler = ref(''),
  connectPercent = ref(5),
  firstRate = ref('1.00'),
  nextRate = ref('0.50'),
  restRate = ref('0.20');
const nativeRamPercent = ref('5.00'),
  cardRamPercent = ref('20.00'),
  storageFreeMb = ref('100.000000'),
  storageUnitGb = ref('1.000000000'),
  storageUnitUsd = ref('1.00');
const thirdParty = ref(500),
  firstParty = ref(10000),
  bump = ref(2000),
  namePremium = ref(2000);
const account = ref(''),
  price = ref('0.0000 TLOS'),
  codeHash = ref(''),
  title = ref(''),
  summary = ref(''),
  detail = ref('');
const dao = computed(() => status.value?.chain?.platformDao);
const member = computed(() =>
  workspace.memberships.find(
    (m) =>
      dao.value &&
      m.dao.chainId === dao.value.chainId &&
      m.dao.contract === dao.value.contract &&
      m.dao.daoId === dao.value.daoId &&
      m.active &&
      m.admin,
  ),
);
const canSign = computed(
  () => !!member.value && signerReady.value && !busy.value && status.value?.chain?.chainMatches,
);
const newPoliciesReady = computed(() =>
  status.value?.chain?.contracts.some(
    (c) => c.account === workspace.network?.runtime && c.codeHash === RuntimeCodeHash,
  ),
);
let sequence = 0;
async function load() {
  const current = ++sequence;
  error.value = '';
  status.value = undefined;
  catalogue.value = undefined;
  try {
    const [s, c] = await Promise.all([api.platformStatus(), api.marketplace()]);
    if (current !== sequence) return;
    status.value = s;
    catalogue.value = c;
    const cfg = s.chain?.creation;
    freeSlots.value = s.chain?.hosting?.free_members ?? 10;
    settler.value = cfg?.settler ?? '';
    connectPercent.value = (s.chain?.paymentPolicy?.bps ?? 500) / 100;
    firstRate.value = ((s.chain?.seatPricing?.first_usd ?? 100) / 100).toFixed(2);
    nextRate.value = ((s.chain?.seatPricing?.next_usd ?? 50) / 100).toFixed(2);
    restRate.value = ((s.chain?.seatPricing?.rest_usd ?? 20) / 100).toFixed(2);
    const resources = s.chain?.resourcePolicy ?? DEFAULT_RESOURCE_POLICY;
    nativeRamPercent.value = formatUnits(BigInt(resources.nativeRamBps), 2);
    cardRamPercent.value = formatUnits(BigInt(resources.cardRamBps), 2);
    storageFreeMb.value = formatUnits(BigInt(resources.storage.freeBytes), 6);
    storageUnitGb.value = formatUnits(BigInt(resources.storage.unitBytes), 9);
    storageUnitUsd.value = formatUnits(BigInt(resources.storage.monthlyUnitUsdCents), 2);
    thirdParty.value = s.chain?.fees?.third_party_bps ?? 500;
    firstParty.value = s.chain?.fees?.first_party_bps ?? 10000;
    bump.value = s.chain?.market?.bump_bps ?? 2000;
    namePremium.value = s.chain?.market?.quote_premium_bps ?? 2000;
  } catch (cause) {
    if (current === sequence) error.value = friendlyError(cause);
  }
}
onMounted(load);
watch(() => workspace.network?.chainId, load);
function actor() {
  if (!dao.value || !member.value) throw new Error('AUTH_REQUIRED');
  return { runtime: dao.value.contract, dao_id: dao.value.daoId, member_id: member.value.memberId };
}
async function sign(action: string, data: Uint8Array) {
  if (!dao.value || !member.value) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await relayInstruction(
      makeInstruction(
        dao.value,
        member.value.memberId,
        member.value.nonce,
        Math.floor(Date.now() / 1000) + 300,
        dao.value.contract,
        action,
        data,
      ),
    );
    await workspace.refresh();
    await load();
    success.value = 'Platform configuration updated on chain.';
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
async function fees() {
  try {
    await sign(
      'govhosted',
      encodeAction('govhosted', {
        ...actor(),
        free_members: freeSlots.value,
        settler: settler.value,
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function resources() {
  success.value = '';
  error.value = '';
  try {
    const current = status.value?.chain?.resourcePolicy ?? DEFAULT_RESOURCE_POLICY;
    const validated = ResourcePolicySchema.safeParse({
      ...current,
      nativeRamBps: Number(parseUnits(nativeRamPercent.value, 2)),
      cardRamBps: Number(parseUnits(cardRamPercent.value, 2)),
      storage: {
        ...current.storage,
        freeBytes: parseUnits(storageFreeMb.value, 6).toString(),
        unitBytes: parseUnits(storageUnitGb.value, 9).toString(),
        monthlyUnitUsdCents: Number(parseUnits(storageUnitUsd.value, 2)),
      },
    });
    if (!validated.success) {
      error.value =
        'Choose fees between 0% and 100%, valid storage units and a positive monthly price.';
      return;
    }
    const policy = validated.data;
    await sign(
      'govresources',
      encodeAction('govresources', {
        ...actor(),
        expected_revision: current.revision,
        native_ram_bps: policy.nativeRamBps,
        card_ram_bps: policy.cardRamBps,
        included_activity_bytes: policy.includedActivityBytes,
        identity_bytes_per_slot: policy.identityBytesPerSlot,
        quote_lifetime_seconds: policy.quoteLifetimeSeconds,
        storage_free_bytes: policy.storage.freeBytes,
        storage_unit_bytes: policy.storage.unitBytes,
        storage_monthly_usd: policy.storage.monthlyUnitUsdCents,
      }),
    );
  } catch (cause) {
    error.value =
      cause instanceof TypeError || cause instanceof RangeError
        ? 'Enter valid decimal resource fees, storage units and a positive monthly price.'
        : friendlyError(cause);
  }
}
async function hostingPrices() {
  try {
    await sign(
      'govseatfee',
      encodeAction('govseatfee', {
        ...actor(),
        first_usd: Number(parseUnits(firstRate.value, 2)),
        next_usd: Number(parseUnits(nextRate.value, 2)),
        rest_usd: Number(parseUnits(restRate.value, 2)),
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function connectFees() {
  try {
    await sign(
      'govpayfees',
      encodeAction('govpayfees', {
        ...actor(),
        bps: Number(parseUnits(String(connectPercent.value), 2)),
      }),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function commissions() {
  try {
    await sign(
      'govfees',
      encodeAction(
        'govfees',
        RuntimeActionSchemas.govfees.parse({
          ...actor(),
          third_party_bps: thirdParty.value,
          first_party_bps: firstParty.value,
          bump_bps: bump.value,
          quote_premium_bps: namePremium.value,
        }),
      ),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function register() {
  try {
    await sign(
      'govlist',
      encodeAction(
        'govlist',
        RuntimeActionSchemas.govlist.parse({
          ...actor(),
          account: account.value,
          price: price.value,
          code_hash: codeHash.value,
          title: title.value,
        }),
      ),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function remove(account: string) {
  try {
    await sign(
      'govunlist',
      encodeAction('govunlist', RuntimeActionSchemas.govunlist.parse({ ...actor(), account })),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
async function describe() {
  try {
    await sign(
      'govmodcopy',
      encodeAction(
        'govmodcopy',
        RuntimeActionSchemas.govmodcopy.parse({
          ...actor(),
          account: account.value,
          summary: summary.value,
          detail: detail.value,
        }),
      ),
    );
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
</script>
<template>
  <ActionSigner :member="member" />
  <div class="page-heading">
    <div>
      <p class="eyebrow">PLATFORM GOVERNANCE</p>
      <h1>Daclify DAO</h1>
      <p class="lead">Manage platform fees and the module catalogue.</p>
    </div>
    <RouterLink to="/status" class="help-link">Platform status ↗</RouterLink>
  </div>
  <p v-if="error" class="alert" role="alert">{{ error }}</p>
  <p v-if="success" role="status">{{ success }}</p>
  <section class="panel">
    <h2>Platform workspace</h2>
    <template v-if="dao"
      ><p>DAO {{ dao.daoId }} · {{ dao.contract }}</p>
      <div class="section-toolbar">
        <RouterLink class="button" :to="'/dao/' + dao.daoId">Open DAO workspace</RouterLink
        ><RouterLink :to="'/dao/' + dao.daoId + '/treasury'">Treasury</RouterLink
        ><RouterLink :to="'/dao/' + dao.daoId + '/decide'">Voting</RouterLink
        ><RouterLink :to="'/dao/' + dao.daoId + '/settings'">Members and governance</RouterLink>
      </div>
      <p>
        {{
          member
            ? 'You are an active platform administrator.'
            : 'Fee and catalogue changes require an active administrator of this linked DAO.'
        }}
        {{ signerReady ? '' : 'Choose an authorized signer.' }}
      </p></template
    >
    <p v-else>
      The runtime has no linked Daclify DAO. A native operator must create and enroll the platform
      DAO and link its ID with setgov before these controls can be used.
    </p>
    <p class="field-help">
      These controls use administrator authority. They do not automatically execute member ballots.
      Native contract upgrades, fee treasury and conversion observations remain operator-controlled.
      <RouterLink to="/docs/platform">Authority guide ↗</RouterLink>
    </p>
  </section>
  <p v-if="!newPoliciesReady" class="notice">
    New hosting, resource and Connect controls require the matching reviewed runtime deployment.
  </p>
  <form class="panel form-panel" @submit.prevent="fees">
    <h2>Shared hosting policy</h2>
    <p>
      DAO creation is free. Existing members retain their rights when paid capacity expires.
      Changing the settler requires matching server configuration.
    </p>
    <fieldset :disabled="!canSign || !newPoliciesReady">
      <label for="free-slots">Included active member slots</label
      ><input
        id="free-slots"
        v-model.number="freeSlots"
        type="number"
        min="1"
        max="5000"
        required
      /><label for="hosting-settler">Trusted payment settler account</label
      ><input id="hosting-settler" v-model="settler" required maxlength="13" /><button>
        Sign hosting policy update
      </button>
    </fieldset>
    <RouterLink to="/docs/shared-hosting">Hosting guide ↗</RouterLink>
  </form>
  <form class="panel form-panel" @submit.prevent="resources">
    <h2>RAM fees and pinned storage policy</h2>
    <p>
      Set prices for new agreements. Existing subscriptions keep their accepted pricing. RAM
      purchases use one rail-specific markup; the two percentages are not added together.
    </p>
    <fieldset :disabled="!canSign || !newPoliciesReady">
      <label for="ram-native-fee">TLOS RAM purchase fee (%)</label>
      <input
        id="ram-native-fee"
        v-model="nativeRamPercent"
        type="text"
        inputmode="decimal"
        required
      />
      <label for="ram-card-fee">Card RAM operational markup (%)</label>
      <input id="ram-card-fee" v-model="cardRamPercent" type="text" inputmode="decimal" required />
      <label for="storage-free">Free pinned storage per DAO (MB)</label>
      <input id="storage-free" v-model="storageFreeMb" type="text" inputmode="decimal" required />
      <label for="storage-unit">Additional storage unit (GB)</label>
      <input id="storage-unit" v-model="storageUnitGb" type="text" inputmode="decimal" required />
      <label for="storage-price">Monthly price per additional unit (USD)</label>
      <input id="storage-price" v-model="storageUnitUsd" type="text" inputmode="decimal" required />
      <button>Sign resource policy update</button>
    </fieldset>
    <p class="field-help">
      1 MB = 1,000,000 bytes; 1 GB = 1,000,000,000 bytes. Archives and old versions use the same
      storage rate. This policy does not allocate RAM or activate paid storage. Purchases,
      subscriptions and automatic cleanup remain under implementation.
    </p>
    <RouterLink to="/docs/platform">Resource policy and authority guide ↗</RouterLink>
  </form>
  <form class="panel form-panel" @submit.prevent="hostingPrices">
    <h2>Graduated monthly capacity prices</h2>
    <p>
      Rates apply to new subscriptions or an explicit administrator-approved switch. Existing
      agreements retain their accepted schedule. Each lower rate applies only to slots in that band.
    </p>
    <fieldset :disabled="!canSign || !newPoliciesReady">
      <label for="rate-first">First 40 paid slots · USD per slot/month</label
      ><input id="rate-first" v-model="firstRate" inputmode="decimal" required /><label
        for="rate-next"
        >Next 200 paid slots · USD per slot/month</label
      ><input id="rate-next" v-model="nextRate" inputmode="decimal" required /><label
        for="rate-rest"
        >Further paid slots · USD per slot/month</label
      ><input id="rate-rest" v-model="restRate" inputmode="decimal" required /><button>
        Sign new subscription pricing
      </button>
    </fieldset>
  </form>
  <form class="panel form-panel" @submit.prevent="connectFees">
    <h2>Daclify Connect commission</h2>
    <p>
      Default 5%. Applies only to eligible DAO module card checkouts processed through Connect.
      Existing orders retain their captured fee; Stripe processing fees are separate.
    </p>
    <fieldset :disabled="!canSign || !newPoliciesReady">
      <label for="connect-percent">Connect commission (%)</label
      ><input
        id="connect-percent"
        v-model.number="connectPercent"
        type="number"
        min="0"
        max="99.99"
        step="0.01"
        required
      /><button>Sign Connect commission update</button>
    </fieldset>
    <RouterLink to="/docs/payments">Payment guide ↗</RouterLink>
  </form>
  <form class="panel form-panel" @submit.prevent="commissions">
    <h2>Module commissions and names</h2>
    <fieldset :disabled="!canSign">
      <label for="fee-third">Third-party platform cut (basis points)</label
      ><input
        id="fee-third"
        v-model.number="thirdParty"
        type="number"
        min="0"
        max="10000"
        required
      /><label for="fee-first">Daclify module platform cut (basis points)</label
      ><input
        id="fee-first"
        v-model.number="firstParty"
        type="number"
        min="0"
        max="10000"
        required
      /><label for="fee-bump">Name resale price increase (basis points)</label
      ><input
        id="fee-bump"
        v-model.number="bump"
        type="number"
        min="0"
        max="10000"
        required
      /><label for="name-premium">Name TLOS conversion premium (basis points)</label
      ><input
        id="name-premium"
        v-model.number="namePremium"
        type="number"
        min="0"
        max="10000"
        required
      /><button>Sign commission policy</button>
    </fieldset>
    <RouterLink to="/marketplace">View modules and name offerings ↗</RouterLink>
  </form>
  <section class="panel">
    <h2>Registered modules</h2>
    <p v-if="!catalogue?.modules.length">No catalogue entries are available.</p>
    <ul v-else>
      <li v-for="module in catalogue.modules" :key="module.account">
        <strong>{{ module.title }}</strong> · {{ module.account }} · {{ module.party }} ·
        {{ module.price
        }}<button class="text-button" :disabled="!canSign" @click="remove(module.account)">
          Remove {{ module.account }} from catalogue
        </button>
      </li>
    </ul>
    <p class="field-help">
      Removal blocks new installations. Existing installations, obligations and withdrawals remain
      intact. Publishers control their third-party prices.
    </p>
  </section>
  <form class="panel form-panel" @submit.prevent="register">
    <h2>Register or update a Daclify module</h2>
    <fieldset :disabled="!canSign">
      <label for="module-account">Native module account</label
      ><input id="module-account" v-model="account" required maxlength="13" /><label
        for="module-title"
        >Title</label
      ><input id="module-title" v-model="title" required maxlength="64" /><label for="module-price"
        >Usage price (native asset)</label
      ><input id="module-price" v-model="price" required maxlength="64" /><label for="module-hash"
        >Verified deployed WASM hash</label
      ><input id="module-hash" v-model="codeHash" required pattern="[0-9a-f]{64}" />
      <p class="field-help">
        The contract verifies this hash and the platform fee rule. First-party publisher is the
        configured fee treasury. Registration does not install it in every DAO.
      </p>
      <button>Sign module registration</button>
    </fieldset>
  </form>
  <form class="panel form-panel" @submit.prevent="describe">
    <h2>Daclify module description</h2>
    <fieldset :disabled="!canSign">
      <label for="copy-account">Native module account</label
      ><input id="copy-account" v-model="account" required maxlength="13" /><label
        for="module-summary"
        >Summary</label
      ><textarea id="module-summary" v-model="summary" required maxlength="160" /><label
        for="module-detail"
        >Details</label
      ><textarea id="module-detail" v-model="detail" required maxlength="2000" /><button>
        Sign description update
      </button>
    </fieldset>
  </form>
</template>
