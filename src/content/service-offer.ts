import type { DaoRef } from '@daclify/core-protocol';
import { ServiceOfferDocumentSchema } from '@daclify/modules';

export function serviceOfferValue(input: {
  dao: DaoRef;
  memberId: string;
  title: string;
  summary: string;
  skills: string;
}): string {
  const skills = input.skills
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  if (new Set(skills.map((value) => value.normalize('NFC').toLowerCase())).size !== skills.length)
    throw new Error('SERVICE_SKILLS_DUPLICATE');
  const value = JSON.stringify(
    ServiceOfferDocumentSchema.parse({
      schemaVersion: 1,
      type: 'service-offer',
      dao: input.dao,
      memberId: input.memberId,
      title: input.title.trim(),
      summary: input.summary.trim(),
      skills,
    }),
  );
  if (new TextEncoder().encode(value).length > 4096) throw new Error('SERVICE_OFFER_SIZE');
  return value;
}
