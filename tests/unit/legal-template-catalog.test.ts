import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GoverningDocumentCategories } from '@daclify/modules';
import { LegalTemplateSchema, legalTemplates } from '../../src/content/legal-templates/catalog';

describe('reviewed legal template catalogue', () => {
  it('ships all twelve source drafts once, with reviewed versioned sources', () => {
    expect(legalTemplates).toHaveLength(12);
    expect(new Set(legalTemplates.map((t) => t.id)).size).toBe(12);
    expect(legalTemplates.map((t) => t.sourceFilename.slice(0, 2))).toEqual(
      Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')),
    );
    for (const template of legalTemplates) {
      expect(LegalTemplateSchema.safeParse(template).success).toBe(true);
      expect(template.revision).toBe('1.0.0');
      expect(GoverningDocumentCategories[template.category]).toBeTruthy();
      expect(template.guidance).toContain('Draft template');
      expect(createHash('sha256').update(template.markdown).digest('hex')).toBe(
        template.sourceSha256,
      );
      expect(new TextEncoder().encode(template.markdown).length).toBeLessThan(131072);
    }
    expect(
      createHash('sha256')
        .update(readFileSync('docs/legal-templates/source-v1.zip'))
        .digest('hex'),
    ).toBe('9408ad036cd86566e4eb14384c8f5f3c08c269c39c9905e65ef27cd255736b41');
  });

  it('defines every editable field, with no ambiguous per-person or milestone tokens', () => {
    for (const template of legalTemplates) {
      const tokens = new Set(
        [...template.markdown.matchAll(/\[([A-Z][A-Z0-9_]*)\]/g)].map((m) => m[1]),
      );
      tokens.delete('DOCUMENT_VERSION');
      tokens.delete('MILESTONES');
      expect([...tokens].sort()).toEqual(template.fields.map((field) => field.key).sort());
      expect(new Set(template.fields.map((f) => f.key)).size).toBe(template.fields.length);
    }
    const membership = legalTemplates.find((t) => t.id === 'dao-membership-agreement');
    expect(membership?.markdown).not.toMatch(/\[(?:MEMBER_ID|AGREEMENT_VERSION|DATE|SIGNATURE_OR_APPROVED_ELECTRONIC_ACCEPTANCE)\]/);
    const contributor = legalTemplates.find((t) => t.id === 'contributor-project-agreement');
    expect(contributor?.markdown).toContain('[MILESTONES]');
    expect(contributor?.markdown).not.toMatch(/\[(?:DATE|AMOUNT|SIGNATURE|DELIVERABLE_[123])\]/);
    expect(legalTemplates[0]?.markdown).not.toMatch(/\[(?:PROPOSAL_ID|APPROVAL_DATE|DOCUMENT_ID_OR_PROPOSAL)\]/);
  });
});
