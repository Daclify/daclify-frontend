import { ABI, Serializer } from '@wharfkit/antelope';
import { CidSchema, NativeAccountSchema } from '@daclify/core-protocol';
import { z } from 'zod';

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

const storedProfile = z.strictObject({
  name: z.string(),
  fullName: z.string().optional(),
  location: z.string().optional(),
  email: z.string().optional(),
  telegram: z.string().optional(),
  introduction: z.string().optional(),
  motto: z.string().optional(),
  facebook: z.string().optional(),
  instagram: z.string().optional(),
  youtube: z.string().optional(),
  linkedin: z.string().optional(),
  website: z.string().optional(),
  avatar: z.string().optional(),
  background: z.string().optional(),
});

export function draftFromProfile(value: string): ProfileDraft {
  const parsed = storedProfile.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error('PROFILE_FIELD');
  const draft = emptyProfile();
  draft.name = parsed.data.name;
  for (const key of textKeys) draft[key] = parsed.data[key] ?? '';
  for (const key of imageFields) draft[key] = parsed.data[key] ?? '';
  return draft;
}

const profileAbi = ABI.from({
  version: 'eosio::abi/1.2',
  types: [],
  structs: [
    {
      name: 'setprofile',
      base: '',
      fields: [
        { name: 'runtime', type: 'name' },
        { name: 'dao_id', type: 'uint64' },
        { name: 'member_id', type: 'uint64' },
        { name: 'account_name', type: 'name' },
        { name: 'profile', type: 'string' },
      ],
    },
  ],
  actions: [],
  tables: [],
  ricardian_clauses: [],
  variants: [],
  action_results: [],
});

export function encodeSetprofile(input: {
  runtime: string;
  daoId: string;
  memberId: string;
  accountName: string;
  profile: string;
}): Uint8Array {
  return Serializer.encode({
    abi: profileAbi,
    type: 'setprofile',
    object: {
      runtime: input.runtime,
      dao_id: input.daoId,
      member_id: input.memberId,
      account_name: input.accountName,
      profile: input.profile,
    },
  }).array;
}
