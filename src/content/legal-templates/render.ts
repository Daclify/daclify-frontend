import { z } from 'zod';
import { daoPaymentKey, IdSchema, FileMetadataSchema, type DaoSummary, type GovernanceState } from '@daclify/core-protocol';
import type { LegalTemplate } from './catalog';
import { percentageText, readableDuration } from '../governance-inputs';

export const LEGAL_DOCUMENT_MAX_BYTES = 131072;
export class LegalDraftError extends Error {}
export type TemplateValues = Readonly<Record<string, string>>;
export type TemplateMilestone = { deliverable: string; dueDate: string; payment: string };
export type TemplateContext = {
  dao: DaoSummary;
  documentId: string;
  documentVersion: number;
  governance: GovernanceState | undefined;
};

function checkContext(context: TemplateContext) {
  IdSchema.parse(context.documentId);
  z.int().min(1).max(0xffffffff).parse(context.documentVersion);
  if (context.governance && (
    daoPaymentKey(context.governance.dao) !== daoPaymentKey(context.dao.reference) ||
    (context.governance.policy && context.governance.policy.dao_id !== context.dao.reference.daoId)
  )) throw new Error('DAO_REFERENCE');
}

export function prefillLegalTemplate(template: LegalTemplate, context: TemplateContext): Record<string, string> {
  checkContext(context);
  const known: Record<string, string> = { DAO_NAME: context.dao.title };
  if (context.dao.description.trim()) known.DAO_MISSION = context.dao.description;
  const policy = context.governance?.policy?.config;
  if (policy) {
    known.QUORUM_PERCENTAGE = `${percentageText(policy.quorum)}%`;
    known.ORDINARY_QUORUM = `${percentageText(policy.quorum)}% of eligible voting weight`;
    known.APPROVAL_THRESHOLD = `at least ${percentageText(policy.approval)}% of cast voting weight for Approve`;
    known.ORDINARY_APPROVAL = known.APPROVAL_THRESHOLD;
    known.MINIMUM_VOTING_PERIOD = readableDuration(policy.duration);
    known.YES_NO_ABSTAIN_OR_OTHER = 'Reject or Approve; abstention means not casting a vote';
  }
  return Object.fromEntries(template.fields.flatMap((field) => {
    const value = known[field.key];
    return value === undefined ? [] : [[field.key, value]];
  }));
}

function escapeField(value: string): string {
  return value.replace(/[\\`*_{}[\]<>#!|]/g, '\\$&');
}

function dateValue(value: string) {
  const date = new Date(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw new LegalDraftError('Enter a valid calendar date.');
}

function markers(body: string): string[] {
  return [...new Set([...body.matchAll(/(?<!\\)\[([A-Z][A-Z0-9_]*)\]/g)].flatMap((match) => match[1] ? [match[1]] : []))];
}

export function validateLegalDraft(_template: LegalTemplate, body: string): string[] {
  const errors: string[] = [];
  if (!body.trim()) errors.push('Enter document text.');
  if (new TextEncoder().encode(body).length > LEGAL_DOCUMENT_MAX_BYTES)
    errors.push('Document text is limited to 128 KiB.');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body)) errors.push('Remove control characters from document text.');
  errors.push(...markers(body).map((key) => `Complete or remove [${key}].`));
  return errors;
}

export function legalFileName(title: string): string {
  const name = title.replace(/[\x00-\x1f/\\]/g, '-').trim().slice(0, 120) || 'DAO document';
  const filename = name + '.md';
  FileMetadataSchema.parse({ version: 1, filename, mediaType: 'text/markdown' });
  return filename;
}

export function assembleLegalDocument(template: LegalTemplate, body: string, context: TemplateContext): string {
  checkContext(context);
  const markdown = body.trimEnd() + `\n\n---\n\nSource template: Daclify ${template.id}\n\nTemplate revision: ${template.revision}\n\nSource SHA-256: ${template.sourceSha256}\n\nDocument ${context.documentId} / version ${context.documentVersion}\n\nThis document was customized from a draft template. Its origin does not establish legal review or execution.\n`;
  if (new TextEncoder().encode(markdown).length > LEGAL_DOCUMENT_MAX_BYTES)
    throw new LegalDraftError('Document including its source reference is limited to 128 KiB.');
  return markdown;
}

export function renderLegalTemplate(
  template: LegalTemplate,
  values: TemplateValues,
  milestones: readonly TemplateMilestone[],
  context: TemplateContext,
): { body: string; markdown: string; unresolved: string[] } {
  checkContext(context);
  const replacements: Record<string, string> = { DOCUMENT_VERSION: String(context.documentVersion) };
  for (const field of template.fields) {
    const value = values[field.key]?.trim();
    if (!value) continue;
    if (value.length > field.maxLength) throw new LegalDraftError(`${field.label} is limited to ${field.maxLength} characters.`);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new LegalDraftError(`Remove control characters from ${field.label}.`);
    if (field.kind === 'date') dateValue(value);
    replacements[field.key] = escapeField(field.kind === 'textarea' ? value : value.replace(/[\r\n\t]+/g, ' '));
  }
  if (template.markdown.includes('[MILESTONES]')) {
    if (milestones.length < 1 || milestones.length > 16) throw new LegalDraftError('Add between 1 and 16 milestones.');
    const complete = milestones.every((row) => row.deliverable.trim() && row.dueDate.trim() && row.payment.trim());
    for (const row of milestones) {
      if (Object.values(row).some((value) => value.length > 500)) throw new LegalDraftError('Milestone fields are limited to 500 characters.');
      if (row.dueDate) dateValue(row.dueDate);
    }
    if (complete) replacements.MILESTONES = '| Milestone | Deliverable | Due date | Payment |\n|---|---|---|---|\n' + milestones.map((row, index) =>
      `| ${index + 1} | ${escapeField(row.deliverable.replace(/[\r\n\t]+/g, ' '))} | ${escapeField(row.dueDate)} | ${escapeField(row.payment.replace(/[\r\n\t]+/g, ' '))} |`,
    ).join('\n');
  }
  const body = template.markdown.replace(/\[([A-Z][A-Z0-9_]*)\]/g, (marker, key: string) => replacements[key] ?? marker);
  return { body, markdown: assembleLegalDocument(template, body, context), unresolved: markers(body) };
}
