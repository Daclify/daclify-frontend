import { describe, expect, it } from 'vitest';
import { CidSchema } from '@daclify/core-protocol';
import {
  draftFromProfile,
  encodeSetprofile,
  profileError,
  profileJson,
  type ProfileDraft,
} from '../../src/auth/profile';

const cid = 'bafkreiehxpuhtr5f6v4eu4byjo2j7kkrhjvd7psmfu4imnpdzb3bdqb7vy';
const draft: ProfileDraft = {
  name: 'alice',
  fullName: 'Ada',
  location: '',
  email: 'ada@example.com',
  telegram: '',
  introduction: '',
  motto: 'build',
  facebook: '',
  instagram: '',
  youtube: '',
  linkedin: '',
  website: 'https://daclify.io',
  avatar: cid,
  background: '',
};

describe('public profile', () => {
  it('accepts a document CID and omits blank fields', () => {
    expect(CidSchema.safeParse(cid).success).toBe(true);
    expect(profileError(draft)).toBeUndefined();
    expect(JSON.parse(profileJson(draft))).toEqual({
      name: 'alice',
      fullName: 'Ada',
      email: 'ada@example.com',
      motto: 'build',
      website: 'https://daclify.io',
      avatar: cid,
    });
    expect(draftFromProfile(profileJson(draft)).avatar).toBe(cid);
  });

  it('rejects an image URL and a long account name', () => {
    expect(profileError({ ...draft, avatar: 'https://cdn.example/a.png' })).toMatch(/IPFS CID/);
    expect(profileError({ ...draft, name: 'toolongname12' })).toMatch(/12 characters/);
    expect(profileError({ ...draft, website: 'http://daclify.io' })).toMatch(/https/);
  });

  it('encodes the profile action for the runtime', () => {
    const bytes = encodeSetprofile({
      runtime: 'daclifycore',
      daoId: '1',
      memberId: '1',
      accountName: 'alice',
      profile: profileJson(draft),
    });
    expect(bytes.byteLength).toBeGreaterThan(20);
  });
});
