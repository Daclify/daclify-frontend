<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { WalletCards, UsersRound, Download, ShieldCheck } from '@lucide/vue';
import {
  formatUnits,
  parseUnits,
  NativeAccountSchema,
  type NamesServiceSchema,
} from '@daclify/core-protocol';
import {
  nameSellerAction,
  nameCreationPermissionActions,
  NamesCodeHash,
} from '@daclify/core-protocol/sdk';
import { z } from 'zod';
import { ApiFailure, friendlyError } from '../api/client';
import { useWorkspace } from '../state/workspace';
import { connectNative, nativeIdentity, nativeNamesTransaction } from '../auth/telos-zero';
const props = defineProps<{ service: z.infer<typeof NamesServiceSchema> }>(),
  emit = defineEmits<{ updated: [] }>();
const state = useWorkspace(),
  mode = ref<'personal' | 'dao'>('personal'),
  kind = ref<'suffix' | 'exact'>('suffix'),
  seller = ref(''),
  name = ref(''),
  tlos = ref(''),
  usd = ref(''),
  consent = ref(false),
  error = ref(''),
  notice = ref(''),
  busy = ref(false);
const editingExact = ref(false);
const contract = computed(() => props.service.contract),
  basic = computed(() => props.service.tiers.find((tier) => tier.kind === 'basic')),
  minimumTlos = computed(() => basic.value?.tlosQuote ?? basic.value?.price),
  needsFloor = computed(() => kind.value === 'suffix' || name.value.includes('.')),
  owned = computed(() => props.service.suffixes.filter((item) => item.seller === seller.value)),
  exact = computed(() => props.service.listings.filter((item) => item.seller === seller.value));
watch(
  minimumTlos,
  (minimum) => {
    if (!tlos.value && minimum) tlos.value = minimum.split(' ')[0] ?? '';
  },
  { immediate: true },
);
function reset() {
  seller.value = '';
  name.value = '';
  consent.value = false;
  editingExact.value = false;
  error.value = '';
  notice.value = '';
}
watch(mode, reset);
watch(
  kind,
  () => {
    editingExact.value = false;
    name.value = '';
  },
  { flush: 'sync' },
);
watch(
  () =>
    JSON.stringify([
      state.account?.id,
      state.network?.chainId,
      state.network?.runtime,
      contract.value,
    ]),
  reset,
);
async function connect() {
  const context = JSON.stringify([
    mode.value,
    state.account?.id,
    state.network?.chainId,
    contract.value,
  ]);
  error.value = '';
  busy.value = true;
  try {
    await connectNative();
    if (
      context !==
        JSON.stringify([mode.value, state.account?.id, state.network?.chainId, contract.value]) ||
      nativeIdentity().chainId !== state.network?.chainId
    )
      throw new Error('WALLET_CONTEXT_CHANGED');
    seller.value = nativeIdentity().account;
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function action() {
  if (!contract.value) throw new Error('NAMES_UNCONFIGURED');
  const account = NativeAccountSchema.parse(seller.value),
    price = `${formatUnits(parseUnits(tlos.value, 4), 4)} TLOS`,
    cents = Number(parseUnits(usd.value || '0', 2));
  if (!consent.value) throw new Error('FEE_RULE');
  if (needsFloor.value) {
    if (!basic.value || !minimumTlos.value) throw new ApiFailure('TIER_UNSET');
    const minimum = parseUnits(minimumTlos.value.split(' ')[0] ?? '', 4),
      units = parseUnits(tlos.value, 4);
    if (units > 0n && minimum === 0n) throw new ApiFailure('TIER_UNSET');
    if (cents > 0 && basic.value.usdCents === 0) throw new ApiFailure('NAME_FEE_REFERENCE');
    if ((units > 0n && units < minimum) || (cents > 0 && cents < basic.value.usdCents))
      throw new ApiFailure('NAME_PRICE_FLOOR');
  }
  return kind.value === 'suffix'
    ? nameSellerAction(contract.value, 'regsuffix', {
        suffix: account,
        price,
        usd_cents: cents,
        accepts_fee_rule: 1,
      })
    : nameSellerAction(contract.value, editingExact.value ? 'editname' : 'regname', {
        seller: account,
        account_name: NativeAccountSchema.parse(name.value),
        price,
        usd_cents: cents,
        accepts_fee_rule: 1,
      });
}
function download(value: object, label: string) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }),
    url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = label;
  link.click();
  URL.revokeObjectURL(url);
}
function exportListing() {
  error.value = '';
  notice.value = '';
  try {
    const item = action();
    download(
      {
        chainId: state.network?.chainId,
        expectedNamesCodeHash: NamesCodeHash,
        actions: [item.toJSON()],
      },
      'daclify-name-listing.json',
    );
    notice.value =
      'Unsigned listing exported. The native seller authority must approve it; a Daclify administrator role cannot sign for that account.';
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
function exportSetup() {
  error.value = '';
  notice.value = '';
  try {
    if (!contract.value) throw new Error('NAMES_UNCONFIGURED');
    const account = NativeAccountSchema.parse(seller.value);
    download(
      {
        chainId: state.network?.chainId,
        expectedNamesCodeHash: NamesCodeHash,
        actions: nameCreationPermissionActions(account, contract.value).map((action) =>
          action.toJSON(),
        ),
      },
      'daclify-name-creation-permission.json',
    );
    notice.value =
      'Owner-review setup exported. It adds namesale under active and links it only to eosio::newaccount. Existing owner and active authority are preserved.';
  } catch (cause) {
    error.value = friendlyError(cause);
  }
}
const formContext = () =>
  JSON.stringify([
    mode.value,
    kind.value,
    seller.value,
    name.value,
    tlos.value,
    usd.value,
    consent.value,
  ]);
async function publish() {
  error.value = '';
  notice.value = '';
  busy.value = true;
  try {
    const item = action(),
      stamp = formContext(),
      id = await nativeNamesTransaction([item], NamesCodeHash, () => {
        if (stamp !== formContext()) throw new Error('WALLET_CONTEXT_CHANGED');
      });
    notice.value = `Listing confirmed. Transaction ${id}`;
    emit('updated');
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
function edit(item: z.infer<typeof NamesServiceSchema>['suffixes'][number]) {
  kind.value = 'suffix';
  seller.value = item.seller;
  tlos.value = item.price.split(' ')[0] ?? '0.0000';
  usd.value = formatUnits(BigInt(item.usdCents), 2);
  consent.value = false;
}
function editExact(item: z.infer<typeof NamesServiceSchema>['listings'][number]) {
  kind.value = 'exact';
  editingExact.value = true;
  name.value = item.accountName;
  seller.value = item.seller;
  tlos.value = item.price.split(' ')[0] ?? '0.0000';
  usd.value = formatUnits(BigInt(item.usdCents), 2);
  consent.value = false;
}
async function removeListing(value: string, suffix: boolean) {
  if (
    !contract.value ||
    !window.confirm(
      `Stop offering ${value}? Existing accounts and sale receipts remain unchanged. Pending purchases may fail and must be coordinated separately.`,
    )
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    const item = suffix
      ? nameSellerAction(contract.value, 'delsuffix', { suffix: value })
      : nameSellerAction(contract.value, 'delname', { seller: seller.value, account_name: value });
    if (mode.value === 'dao') {
      download(
        {
          chainId: state.network?.chainId,
          expectedNamesCodeHash: NamesCodeHash,
          actions: [item.toJSON()],
        },
        'daclify-name-removal.json',
      );
      notice.value = 'Unsigned removal exported for the native seller quorum.';
    } else {
      await nativeNamesTransaction([item], NamesCodeHash);
      emit('updated');
      notice.value = 'Listing removed on-chain.';
    }
  } catch (cause) {
    error.value = friendlyError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="names-management">
    <div class="two-column">
      <button
        type="button"
        class="names-mode"
        :aria-pressed="mode === 'personal'"
        @click="mode = 'personal'"
      >
        <WalletCards aria-hidden="true" /><strong>My native account</strong
        ><span>Sell names under a suffix you own.</span></button
      ><button
        type="button"
        class="names-mode"
        :aria-pressed="mode === 'dao'"
        @click="mode = 'dao'"
      >
        <UsersRound aria-hidden="true" /><strong>DAO-controlled account</strong
        ><span>Let your native-account quorum approve listings.</span>
      </button>
    </div>
    <div class="two-column">
      <section class="panel form-panel">
        <h2>{{ mode === 'personal' ? 'Manage your names' : 'Manage DAO names' }}</h2>
        <p v-if="mode === 'dao'" class="notice">
          Use a native seller account controlled by your DAO’s executives. Shared DAO administration
          does not control Daclify’s runtime account. A shared DAO needs its own native seller
          account; proceeds go to that native account.
        </p>
        <p v-else>
          Connect the native wallet that owns your suffix. Public profile handles are separate from
          Telos accounts.
        </p>
        <button
          v-if="mode === 'personal'"
          type="button"
          class="secondary"
          :disabled="busy"
          @click="connect"
        >
          {{ busy ? 'Connecting…' : 'Connect seller wallet' }}
        </button>
        <form @submit.prevent="mode === 'dao' ? exportListing() : publish()">
          <label for="name-seller">Native seller account</label
          ><input
            id="name-seller"
            v-model="seller"
            :readonly="mode === 'personal'"
            required
            maxlength="12"
            placeholder="e.g. mydao"
          /><label for="seller-kind">What are you selling?</label
          ><select id="seller-kind" v-model="kind">
            <option value="suffix">Names under my suffix</option>
            <option value="exact">One new exact name</option></select
          ><template v-if="kind === 'exact'"
            ><label for="seller-exact-name">New name to list</label
            ><input
              id="seller-exact-name"
              v-model="name"
              :readonly="editingExact"
              required
              maxlength="12"
              placeholder="alice.mydao"
            />
            <p class="field-help">
              The native account must not exist yet. Dotted names must end in your seller account.
              Short undotted names require a closed native auction won by your seller account.
            </p></template
          ><label for="seller-tlos">Price in TLOS</label
          ><input
            id="seller-tlos"
            v-model="tlos"
            inputmode="decimal"
            required
            :aria-describedby="needsFloor ? 'seller-price-minimum' : undefined"
          />
          <p v-if="needsFloor" id="seller-price-minimum" class="field-help">
            <template v-if="minimumTlos"
              >Current suffix minimum: {{ minimumTlos
              }}<template v-if="basic && basic.usdCents > 0"
                >; USD reference minimum: ${{ formatUnits(BigInt(basic.usdCents), 2) }}</template
              >. Suffix accounts cost at least as much as a normal account. The minimum follows
              current resource and TLOS prices; older offers adjust at purchase.</template
            >
            <template v-else
              >The normal account minimum is unavailable. Refresh the name service before listing a
              suffix.</template
            >
          </p>
          <label for="seller-usd">Reference price in USD (card sales unavailable)</label
          ><input
            id="seller-usd"
            v-model="usd"
            inputmode="decimal"
            placeholder="Optional USD reference"
          />
          <p class="field-help">
            Third-party card sales are disabled until seller merchant routing is implemented. Set a
            TLOS price. Publishing a USD price alone does not connect Stripe.
          </p>
          <label class="check-line"
            ><input v-model="consent" type="checkbox" />I accept the platform’s
            {{ (service.thirdPartyBps ?? 0) / 100 }}% fee and {{ (service.bumpBps ?? 0) / 100 }}%
            price increase after each suffix sale.</label
          ><button :disabled="busy || !consent || !seller || !contract">
            {{ mode === 'dao' ? 'Export for DAO approval' : 'Sign and publish listing' }}
          </button>
        </form>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      </section>
      <aside>
        <section class="panel">
          <ShieldCheck class="names-feature-icon" aria-hidden="true" />
          <h2>Approve creation authority</h2>
          <p>
            Before selling a suffix or a special exact name, its native account owner must approve
            the dedicated namesale permission. It lets the reviewed names contract create accounts,
            without granting transfers or rewriting owner/active authority.
          </p>
          <p class="field-help">
            Review the contract hash, parent permissions and action link before signing. Existing
            custom newaccount links must be reviewed before replacement. You can revoke this
            permission to stop fulfillment; coordinate pending purchases first.
          </p>
          <button
            type="button"
            class="secondary"
            :disabled="!seller || !contract"
            @click="exportSetup"
          >
            <Download aria-hidden="true" />Export owner-review setup</button
          ><RouterLink class="seller-guide" to="/docs/marketplace"
            >Read the seller guide ↗</RouterLink
          >
        </section>
        <section class="panel">
          <h3>Know what you are listing</h3>
          <p>
            These listings create new Telos accounts. They do not sell an existing account or
            transfer its owner key.
          </p>
          <p>
            Reprice or remove unsold listings after the reviewed names upgrade. Sold accounts and
            sale receipts remain unchanged. Pending purchases need coordination before removal.
          </p>
        </section>
      </aside>
    </div>
    <section class="panel">
      <h2>Seller inventory</h2>
      <p v-if="!seller">Select a seller to see its public listings.</p>
      <p v-else-if="!owned.length && !exact.length">No published listings for {{ seller }} yet.</p>
      <div class="names-grid">
        <article v-for="item in owned" :key="item.suffix" class="name-offer">
          <h3>.{{ item.suffix }}</h3>
          <p>Seller reference: {{ item.price }} · {{ item.sales }} sales</p>
          <button class="secondary" type="button" @click="edit(item)">Update suffix price</button>
          <button
            type="button"
            class="text-button"
            :disabled="busy"
            @click="removeListing(item.suffix, true)"
          >
            Remove suffix listing
          </button>
        </article>
        <article v-for="item in exact" :key="item.accountName" class="name-offer">
          <h3>{{ item.accountName }}</h3>
          <p>Seller reference: {{ item.price }} · {{ item.sold ? 'Sold' : 'Listed' }}</p>
          <div v-if="!item.sold" class="button-row">
            <button type="button" class="secondary" @click="editExact(item)">Edit listing</button
            ><button
              type="button"
              class="text-button"
              :disabled="busy"
              @click="removeListing(item.accountName, false)"
            >
              Remove listing
            </button>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>
