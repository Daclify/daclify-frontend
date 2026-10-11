import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  PeopleRoutes,
  unifyPublicMembers,
  type PublicMember,
  type PublicProfile,
} from '@daclify/core-protocol';
import { z } from 'zod';
import { api, friendlyError } from '../api/client';
import { useWorkspace } from './workspace';

type Page = z.infer<typeof PeopleRoutes.members.response>;
type Cursor = Page['next'];
export type CommunityLink = { key: string; title: string; to: string; active: boolean };
export async function loadPublicMemberBatch(
  loadPage: (query?: z.infer<typeof PeopleRoutes.members.query>) => Promise<Page>,
  append: (page: Page) => void,
  cursor: Cursor = null,
  current: () => boolean = () => true,
) {
  for (let count = 0; count < 20 && current(); count++) {
    const page = await loadPage(cursor ?? undefined);
    if (!current()) return;
    if (page.next) {
      const previous = BigInt(cursor?.daoId ?? '0'),
        next = BigInt(page.next.daoId);
      if (
        next < previous ||
        (next === previous && BigInt(page.next.after) <= BigInt(cursor?.after ?? '0'))
      )
        throw new Error('CHAIN_RESPONSE_INVALID');
    }
    append(page);
    cursor = page.next;
    if (!cursor) return;
  }
}
export function usePublicDirectory() {
  const state = useWorkspace(),
    people = ref<PublicMember[]>([]),
    next = ref<Cursor>(null),
    busy = ref(false),
    error = ref('');
  let generation = 0,
    disposed = false;
  async function load(reset = false) {
    if (reset) {
      generation++;
      people.value = [];
      next.value = null;
      busy.value = false;
    }
    if (busy.value) return;
    const request = generation;
    busy.value = true;
    error.value = '';
    try {
      await loadPublicMemberBatch(
        api.publicMembers,
        (page) => {
          people.value.push(...page.members);
          next.value = page.next;
        },
        next.value,
        () => !disposed && request === generation,
      );
    } catch (cause) {
      if (!disposed && request === generation) error.value = friendlyError(cause);
    } finally {
      if (!disposed && request === generation) busy.value = false;
    }
  }
  watch(
    () => JSON.stringify([state.network?.chainId, state.network?.runtime, state.account?.id]),
    () => {
      void load(true);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
  });
  const users = computed(() =>
    unifyPublicMembers(
      people.value.filter(
        (p) => p.dao.chainId === state.network?.chainId && p.dao.contract === state.network.runtime,
      ),
    ),
  );
  return { people, users, next, busy, error, load };
}
export function profileContacts(profile?: PublicProfile | null) {
  const contacts: Array<{ key: string; label: string; href?: string }> = [];
  if (profile?.email)
    contacts.push({
      key: 'email',
      label: profile.email,
      ...(z.email().safeParse(profile.email).success
        ? { href: `mailto:${encodeURIComponent(profile.email)}` }
        : {}),
    });
  if (profile?.telegram)
    contacts.push({
      key: 'telegram',
      label: profile.telegram,
      ...(/^@?[a-zA-Z0-9_]{5,32}$/.test(profile.telegram)
        ? { href: `https://t.me/${profile.telegram.replace(/^@/, '')}` }
        : {}),
    });
  for (const key of ['website', 'facebook', 'instagram', 'youtube', 'linkedin'] as const) {
    const value = profile?.[key];
    if (!value) continue;
    let safe = false;
    try {
      const url = new URL(value);
      safe = url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      /* Invalid text remains non-navigable. */
    }
    contacts.push({
      key,
      label: key === 'website' && safe ? new URL(value).hostname : key,
      ...(safe ? { href: value } : {}),
    });
  }
  return contacts;
}
export function activityText(lastActive: number | null, now = Math.floor(Date.now() / 1000)) {
  if (lastActive === null) return 'DAO activity not recorded';
  const elapsed = Math.max(0, now - lastActive);
  if (elapsed < 60) return 'Last DAO action just now';
  const [seconds, unit] =
    elapsed < 3600
      ? ([60, 'minute'] as const)
      : elapsed < 86400
        ? ([3600, 'hour'] as const)
        : ([86400, 'day'] as const);
  return `Last DAO action ${new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(-Math.floor(elapsed / seconds), unit)}`;
}
