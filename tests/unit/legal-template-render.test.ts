import { describe, expect, it } from 'vitest';
import { DaoSummarySchema, GovernanceStateSchema } from '@daclify/core-protocol';
import { legalTemplates } from '../../src/content/legal-templates/catalog';
import { formatHelpAnswer } from '../../src/help/format';
import {
  assembleLegalDocument, legalFileName, prefillLegalTemplate, renderLegalTemplate,
  validateLegalDraft, type TemplateContext,
} from '../../src/content/legal-templates/render';

const dao = DaoSummarySchema.parse({
  reference: { chainId: 'ab'.repeat(32), contract: 'daclifycore', daoId: '1', interfaceVersion: 1 },
  title: 'Community $& $1', description: 'A shared purpose', privacy: 'public', owner: 'alice',
  token: { chainId: 'ab'.repeat(32), contract: 'eosio.token', symbol: 'TLOS', precision: 4 },
  members: 1, available: '0', reserved: '0', claims: '0', keyEpoch: '1',
});
const context: TemplateContext = { dao, documentId: '42', documentVersion: 1, governance: undefined };
const milestone = { deliverable: 'One | deliverable\nnext line', dueDate: '2026-12-01', payment: '12.3456 TLOS' };
function template(id: string) {
  const value = legalTemplates.find((t) => t.id === id);
  if (!value) throw new Error('FIXTURE_TEMPLATE');
  return value;
}
describe('legal draft rendering', () => {
  it('renders every template with explicit values and immutable provenance', () => {
    for (const t of legalTemplates) {
      const values = Object.fromEntries(t.fields.map((f) => [f.key, f.kind === 'date' ? '2026-12-01' : 'Reviewed choice']));
      const result = renderLegalTemplate(t, values, [milestone], context);
      expect(result.unresolved).toEqual([]);
      expect(validateLegalDraft(t, result.body)).toEqual([]);
      expect(result.markdown).toContain(t.sourceSha256);
      expect(result.markdown).toContain('Document 42 / version 1');
      expect(result.markdown).toContain('Template revision: 1.0.0');
      const frozen = result.markdown;
      expect(assembleLegalDocument(t, result.body, { ...context, documentVersion: 2 })).toContain('version 2');
      expect(result.markdown).toBe(frozen);
    }
  });
  it('uses literal single-pass replacement and safely renders field values', () => {
    const t = template('code-of-conduct');
    const result = renderLegalTemplate(t, { DAO_NAME: '$& $1 [EFFECTIVE_DATE] <script>alert(1)</script>', EFFECTIVE_DATE: '2026-12-01', DESIGNATED_CONTACT_OR_COMMITTEE: '**Contact**' }, [], context);
    expect(result.body).toContain('$& $1 \\[EFFECTIVE\\_DATE\\]');
    const html = formatHelpAnswer(result.markdown);
    expect(html).not.toMatch(/<(?:script|img|iframe)\b/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<strong>Contact</strong>');
    expect(result.unresolved).toEqual([]);
  });
  it('keeps missing fields visible and refuses unknown markers and empty edited bodies', () => {
    const t = template('code-of-conduct');
    const result = renderLegalTemplate(t, { DAO_NAME: '  ' }, [], context);
    expect(result.unresolved).toContain('DAO_NAME');
    expect(validateLegalDraft(t, result.body).length).toBeGreaterThan(0);
    expect(validateLegalDraft(t, 'Text [UNKNOWN_FIELD]')).toContain('Complete or remove [UNKNOWN_FIELD].');
    expect(validateLegalDraft(t, '  ')).toContain('Enter document text.');
  });
  it('bounds UTF-8 bytes, field length, versions and safe filenames', () => {
    const t = template('code-of-conduct');
    expect(() => renderLegalTemplate(t, { DAO_NAME: 'x'.repeat(501) }, [], context)).toThrow();
    expect(() => renderLegalTemplate(t, {}, [], { ...context, documentVersion: 0 })).toThrow();
    expect(() => renderLegalTemplate(t, { EFFECTIVE_DATE: '2026-02-30' }, [], context)).toThrow();
    expect(validateLegalDraft(t, 'é'.repeat(65537))).toContain('Document text is limited to 128 KiB.');
    expect(() => assembleLegalDocument(t, 'x'.repeat(131072), context)).toThrow();
    expect(legalFileName('../name\\with\ncontrols')).not.toMatch(/[\/\\\n]/);
    expect(legalFileName('x'.repeat(120))).toHaveLength(123);
  });
  it('keeps 1–16 milestone rows separate and escapes table positions', () => {
    const t = template('contributor-project-agreement');
    expect(() => renderLegalTemplate(t, {}, [], context)).toThrow();
    expect(() => renderLegalTemplate(t, {}, Array.from({ length: 17 }, () => milestone), context)).toThrow();
    const result = renderLegalTemplate(t, {}, Array.from({ length: 16 }, () => milestone), context);
    expect(result.body).toContain('One \\| deliverable next line');
    expect(result.body).toContain('| 16 |');
    expect(result.body).toContain('12.3456 TLOS');
    expect(renderLegalTemplate(t, {}, [{ ...milestone, payment: '' }], context).unresolved).toContain('MILESTONES');
  });
  it('only prefills known policy facts from this DAO and never invents special thresholds', () => {
    const t = template('governance-voting-policy');
    expect(prefillLegalTemplate(t, context)).toEqual({ DAO_NAME: dao.title });
    const governance = GovernanceStateSchema.parse({ dao: dao.reference, policy: { dao_id: '1', revision: '2', config: { participant_mode: 0, decide: 'decide', guardian: '', kind: 1, duration: 259200, quorum: 5000, approval: 5001, governed_works: true, max_commitment: 0, daily_commitment: 0 } }, actors: [], sessions: [], guardian: null, budget: null });
    const values = prefillLegalTemplate(t, { ...context, governance });
    expect(values.ORDINARY_QUORUM).toBe('50% of eligible voting weight');
    expect(values.ORDINARY_APPROVAL).toBe('at least 50.01% of cast voting weight for Approve');
    expect(values.MINIMUM_VOTING_PERIOD).toBe('3 days');
    expect(values.YES_NO_ABSTAIN_OR_OTHER).toBe('Reject or Approve; abstention means not casting a vote');
    expect(values.CONSTITUTIONAL_APPROVAL).toBeUndefined();
    expect(values.CONSTITUTIONAL_QUORUM).toBeUndefined();
    expect(() => prefillLegalTemplate(t, { ...context, governance: { ...governance, dao: { ...dao.reference, daoId: '2' } } })).toThrow('DAO_REFERENCE');
    expect(prefillLegalTemplate(t, { ...context, governance: { ...governance, policy: null } })).toEqual({ DAO_NAME: dao.title });
  });
});
