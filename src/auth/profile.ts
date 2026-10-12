import {
  CidSchema,
  NativeAccountSchema,
  PublicProfileSchema,
  type Network,
  type ProfileContext,
  type EncryptionPublicKey,
  type EncryptedProfile,
  type ProfileKeyGrant,
  type DaoRef,
  type PublicProfile,
} from '@daclify/core-protocol';
import { encodeAction } from '@daclify/core-protocol/sdk';
import { decodeRawNativeProfile } from '@daclify/core-protocol/profiles';
import { preparePrivateProfile, openPrivateProfile } from './session';
import { api } from '../api/client';
export function legacyProfileAllowed(network: Pick<Network, 'capabilities'> | undefined): boolean {
  return !!network && !network.capabilities.includes('encrypted-profiles-v2');
}

export interface ProfileDraft {
  name: string;
  fullName: string;
  location: string;
  email: string;
  telegram: string;
  introduction: string;
  motto: string;
  facebook: string;
  instagram: string;
  youtube: string;
  linkedin: string;
  website: string;
  avatar: string;
  background: string;
}

const textLimits = {
  fullName: 80,
  location: 80,
  email: 254,
  telegram: 32,
  introduction: 2000,
  motto: 140,
  facebook: 300,
  instagram: 300,
  youtube: 300,
  linkedin: 300,
  website: 300,
} as const;

const linkFields = ['facebook', 'instagram', 'youtube', 'linkedin', 'website'] as const;
const imageFields = ['avatar', 'background'] as const;

export function emptyProfile(): ProfileDraft {
  return {
    name: '',
    fullName: '',
    location: '',
    email: '',
    telegram: '',
    introduction: '',
    motto: '',
    facebook: '',
    instagram: '',
    youtube: '',
    linkedin: '',
    website: '',
    avatar: '',
    background: '',
  };
}

const textKeys = Object.keys(textLimits) as (keyof typeof textLimits)[];

export function profileError(draft: ProfileDraft): string | undefined {
  if (
    draft.name.length > 12 ||
    draft.name.startsWith('.') ||
    draft.name.includes('..') ||
    !NativeAccountSchema.safeParse(draft.name).success
  )
    return 'Use an account name of at most 12 characters: a–z, 1–5, and a dot.';
  for (const key of textKeys) {
    if (draft[key].length > textLimits[key]) return `${key} is too long.`;
  }
  if (draft.email !== '' && (draft.email.includes(' ') || !draft.email.includes('@')))
    return 'Enter an email address, or leave it blank.';
  if (draft.telegram !== '' && !/^[A-Za-z0-9_]{5,32}$/.test(draft.telegram))
    return 'Telegram is 5 to 32 letters, numbers, or underscores.';
  for (const key of linkFields) {
    const value = draft[key];
    if (value !== '' && (!value.startsWith('https://') || value.includes(' ')))
      return `${key} must be an https link.`;
  }
  for (const key of imageFields) {
    if (draft[key] !== '' && !CidSchema.safeParse(draft[key]).success)
      return `${key} must be an IPFS CID, the same kind a document uses.`;
  }
  if (new TextEncoder().encode(profileJson(draft)).byteLength > 4096)
    return 'The profile is larger than the contract allows.';
  return undefined;
}

export function profileJson(draft: ProfileDraft): string {
  const value: Record<string, string> = { name: draft.name };
  for (const key of textKeys) {
    if (draft[key] !== '') value[key] = draft[key];
  }
  for (const key of imageFields) {
    if (draft[key] !== '') value[key] = draft[key];
  }
  return JSON.stringify(value);
}

export function draftFromProfile(value: string): ProfileDraft {
  const parsed = PublicProfileSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error('PROFILE_FIELD');
  const draft = emptyProfile();
  draft.name = parsed.data.name;
  for (const key of textKeys) draft[key] = parsed.data[key] ?? '';
  for (const key of imageFields) draft[key] = parsed.data[key] ?? '';
  return draft;
}

export function encodeSetprofile(input: {
  runtime: string;
  daoId: string;
  memberId: string;
  accountName: string;
  profile: string;
}): Uint8Array {
  return encodeAction('setprofile', {
    runtime: input.runtime,
    dao_id: input.daoId,
    member_id: input.memberId,
    account_name: input.accountName,
    profile: input.profile,
  });
}

export function encryptedProfileAllowed(
  network: Pick<Network, 'capabilities'> | undefined,
): boolean {
  return (
    !!network?.capabilities.includes('encrypted-profiles-v2') &&
    network.capabilities.includes('profile-key-envelopes-v1')
  );
}
export interface PreparedProfile {
  cipher: EncryptedProfile;
  grants: ProfileKeyGrant[];
}
export async function prepareEncryptedProfile(
  draft: ProfileDraft,
  context: ProfileContext,
  audience: EncryptionPublicKey[],
  includeImages = false,
): Promise<PreparedProfile> {
  const value = { ...draft, ...(!includeImages ? { avatar: '', background: '' } : {}) };
  const error = profileError(value);
  if (error) throw new Error(error);
  const plaintext = new TextEncoder().encode(profileJson(value));
  try {
    return await preparePrivateProfile(plaintext, context, audience);
  } finally {
    plaintext.fill(0);
  }
}
export function encodeSetEncryptedProfile(
  accountName: string,
  cipher: EncryptedProfile,
): Uint8Array {
  return encodeAction('setencprof', {
    actor: {
      runtime: cipher.context.runtime,
      dao_id: cipher.context.daoId,
      member_id: cipher.context.memberId,
    },
    account_name: accountName,
    profile: JSON.stringify(cipher),
  });
}
export async function readProfileForAudience(
  row: Awaited<ReturnType<typeof api.memberProfile>>,
  dao: DaoRef,
  memberId: string,
): Promise<PublicProfile | undefined> {
  if (!row.profile) return undefined;
  const decoded = decodeRawNativeProfile(row);
  let profile: PublicProfile;
  if (decoded.version === 1) profile = decoded.profile;
  else {
    if (
      decoded.context.chainId !== dao.chainId ||
      decoded.context.runtime !== dao.contract ||
      decoded.context.daoId !== dao.daoId ||
      decoded.context.memberId !== memberId
    )
      throw new Error('PROFILE_CONTEXT');
    const grant = await api.profileKeys(decoded.context);
    const plaintext = await openPrivateProfile(decoded, grant);
    try {
      profile = PublicProfileSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
    } finally {
      plaintext.fill(0);
    }
  }
  if (profile.name !== row.accountName) throw new Error('PROFILE_CONTEXT');
  return profile;
}
