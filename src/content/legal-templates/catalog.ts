import { z } from 'zod';
import type { DecideActions } from '@daclify/modules/sdk';

export const LegalTemplateSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  revision: z.literal('1.0.0'),
  title: z.string().min(1).max(120),
  purpose: z.string().min(1).max(500),
  category: z.number().int().min(0).max(4),
  sourceFilename: z.string().regex(/^\d{2}-[a-z0-9-]+\.md$/),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  guidance: z.string().min(1).max(2000),
  markdown: z.string().min(1),
  fields: z.array(z.strictObject({
    key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    label: z.string().min(1).max(120),
    kind: z.enum(['text', 'textarea', 'date']),
    maxLength: z.union([z.literal(500), z.literal(8000)]),
  })).max(32),
  suggestAcceptance: z.boolean(),
});
export type LegalTemplate = z.infer<typeof LegalTemplateSchema> & {
  category: DecideActions['regdoc']['category'];
};
export type LegalTemplateId = LegalTemplate['id'];
const sources = import.meta.glob<string>('./templates/*.md', { query: '?raw', import: 'default', eager: true });
const descriptors = [
  {
    "id": "dao-constitution-charter",
    "revision": "1.0.0",
    "title": "DAO Constitution and Charter",
    "purpose": "Define your DAO’s purpose, membership and governing principles.",
    "category": 0,
    "sourceFilename": "01-dao-constitution-charter.md",
    "sourceSha256": "e48cddf8b7c3110fa88b0148db97e7ae61f6188f009393e6d813a07f18b7f6a8",
    "guidance": "**Draft template:** Adapt to the DAO's legal structure, applicable law, and governance configuration before adoption. This document alone does not create a legal entity or limited liability.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      },
      {
        "key": "DAO_MISSION",
        "label": "Mission",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "QUORUM_PERCENTAGE",
        "label": "Ordinary quorum",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "APPROVAL_THRESHOLD",
        "label": "Ordinary approval threshold and denominator",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "AMENDMENT_THRESHOLD",
        "label": "Amendment approval requirements",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "LEGAL_STATUS",
        "label": "Legal status",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "LEGAL_ENTITY_APPROVAL",
        "label": "Legal entity approval reference (or not applicable)",
        "kind": "text",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": true
  },
  {
    "id": "dao-membership-agreement",
    "revision": "1.0.0",
    "title": "DAO Membership Agreement",
    "purpose": "Record the common terms accepted by each DAO member.",
    "category": 2,
    "sourceFilename": "02-dao-membership-agreement.md",
    "sourceSha256": "c442f4197a15fc2fdea82d7d3b210949f22e130d5507bbe0cc2aeb02435c5e63",
    "guidance": "**Draft template:** Review membership eligibility, consumer rights, legal status, and enforceability before requesting acceptance.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": true
  },
  {
    "id": "governance-voting-policy",
    "revision": "1.0.0",
    "title": "Governance and Voting Policy",
    "purpose": "Describe proposal eligibility, voting and approval rules.",
    "category": 1,
    "sourceFilename": "03-governance-voting-policy.md",
    "sourceSha256": "dbe3dcbfc218fdab3d6763c833b2368173181757e7cedd2a1eaaf2da015a62dc",
    "guidance": "**Draft template:** Configure the actual ballot, governance-credit, quorum, and smart-contract behavior to match the approved rules. Never promise enforcement a system does not provide.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      },
      {
        "key": "ORDINARY_QUORUM",
        "label": "Ordinary quorum",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "ORDINARY_APPROVAL",
        "label": "Ordinary approval threshold and denominator",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "CONSTITUTIONAL_QUORUM",
        "label": "Constitutional quorum",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "CONSTITUTIONAL_APPROVAL",
        "label": "Constitutional approval requirements",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "MINIMUM_VOTING_PERIOD",
        "label": "Minimum voting period",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "YES_NO_ABSTAIN_OR_OTHER",
        "label": "Voting choices",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EMERGENCY_REVIEW_PERIOD",
        "label": "Emergency review period",
        "kind": "text",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": false
  },
  {
    "id": "treasury-management-spending-policy",
    "revision": "1.0.0",
    "title": "Treasury Management and Spending Policy",
    "purpose": "Document treasury custody, spending controls and reporting.",
    "category": 1,
    "sourceFilename": "04-treasury-management-spending-policy.md",
    "sourceSha256": "420135ecbcfa8022b74612174d55b8578c1243af9ca103eee79e93ac82ad0335",
    "guidance": "**Draft template:** Confirm who legally owns the assets, the authorized payment mechanisms, and applicable tax, accounting, and regulatory obligations before implementation.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      },
      {
        "key": "LIMIT",
        "label": "Routine spending limit and currency",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "HIGH_VALUE_THRESHOLD",
        "label": "High-value spending threshold",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "SIGNER_POLICY",
        "label": "Required signers and approval roles",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "EMERGENCY_POLICY",
        "label": "Emergency spending procedure",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "REPORTING_PERIOD",
        "label": "Financial reporting frequency",
        "kind": "text",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": false
  },
  {
    "id": "code-of-conduct",
    "revision": "1.0.0",
    "title": "DAO Code of Conduct",
    "purpose": "Set expectations for participation and reporting concerns.",
    "category": 1,
    "sourceFilename": "05-code-of-conduct.md",
    "sourceSha256": "88685c6f772a4d2f581eea00cbbabcbf1c18eea49fc464fddd45ca462d0c7393",
    "guidance": "**Draft template:** Adapt the enforcement process to membership rules and applicable law.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      },
      {
        "key": "DESIGNATED_CONTACT_OR_COMMITTEE",
        "label": "Conduct reporting contact or committee",
        "kind": "text",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": true
  },
  {
    "id": "conflict-of-interest-policy",
    "revision": "1.0.0",
    "title": "Conflict of Interest Policy",
    "purpose": "Explain disclosure and handling of conflicting interests.",
    "category": 1,
    "sourceFilename": "06-conflict-of-interest-policy.md",
    "sourceSha256": "f812d71b22bc89570412f017a5c784992efedf7b2c52127cc74858639b2041ce",
    "guidance": "**Draft template:** Actual requirements may vary for charities, regulated organizations, directors, and legally constituted cooperatives.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": false
  },
  {
    "id": "contributor-project-agreement",
    "revision": "1.0.0",
    "title": "Contributor and Project Agreement",
    "purpose": "Define the parties, deliverables and terms for one engagement.",
    "category": 2,
    "sourceFilename": "07-contributor-project-agreement.md",
    "sourceSha256": "2f82aec8bb38591977933a9c6fc5acedf0c4ff613e887e2c4f44415e309c8a8d",
    "guidance": "**Draft template:** This contract needs identifiable legal parties, agreed consideration, governing law, tax treatment, and signatures. A governance vote is not a substitute for a valid contract.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "CONTRIBUTOR_NAME",
        "label": "Contributor display name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "PROJECT_NAME",
        "label": "Project name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "AGREEMENT_DATE",
        "label": "Agreement date",
        "kind": "date",
        "maxLength": 500
      },
      {
        "key": "LEGAL_CONTRACTING_PARTY",
        "label": "DAO contracting person or legal entity",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "CONTRIBUTOR_LEGAL_NAME",
        "label": "Contributor legal name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "DESCRIPTION_OF_WORK",
        "label": "Scope and deliverables",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "PAYMENT_SCHEDULE",
        "label": "Currency, payments, taxes and invoicing",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "IP_ASSIGNMENT_OR_LICENSE_TERMS",
        "label": "Intellectual property and licence terms",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "TERMINATION_NOTICE_AND_CONDITIONS",
        "label": "Termination conditions and notice",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "JURISDICTION",
        "label": "Governing law",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "DISPUTE_RESOLUTION_MECHANISM",
        "label": "Contract dispute procedure",
        "kind": "textarea",
        "maxLength": 8000
      }
    ],
    "suggestAcceptance": false
  },
  {
    "id": "dispute-resolution-policy",
    "revision": "1.0.0",
    "title": "DAO Dispute Resolution Policy",
    "purpose": "Document complaints, independent review and appeals.",
    "category": 1,
    "sourceFilename": "08-dispute-resolution-policy.md",
    "sourceSha256": "70726b1af6a5ae1a0722f2522cdb917f5c83bb92d3d164b84b277b3beb15e0ba",
    "guidance": "**Draft template:** This policy cannot remove mandatory rights to legal remedies, whistleblower protections, or access to regulators.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      },
      {
        "key": "DISPUTE_CONTACT",
        "label": "Complaint contact",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "REVIEW_PERIOD",
        "label": "Review period",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "APPEAL_PERIOD",
        "label": "Appeal period",
        "kind": "text",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": false
  },
  {
    "id": "privacy-confidentiality-policy",
    "revision": "1.0.0",
    "title": "DAO Privacy and Confidentiality Policy",
    "purpose": "Describe responsibility, confidentiality and data-handling practices.",
    "category": 1,
    "sourceFilename": "09-privacy-confidentiality-policy.md",
    "sourceSha256": "7bc37580c276419665f35f75bbe233459f1ad66c98357025f91bcf46d766e90b",
    "guidance": "**Draft template:** This is a starting policy, **not** a complete GDPR privacy notice or data-processing agreement. Identify the actual controller, purposes, legal bases, recipients, transfers, retention, and rights procedures before publishing.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      },
      {
        "key": "CONTROLLER_LEGAL_NAME_AND_CONTACT",
        "label": "Responsible controller and contact details",
        "kind": "textarea",
        "maxLength": 8000
      },
      {
        "key": "CONTACT",
        "label": "Data protection contact",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "PRIVACY_CONTACT",
        "label": "Privacy requests contact",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "RETENTION_SCHEDULE",
        "label": "Retention schedule",
        "kind": "textarea",
        "maxLength": 8000
      }
    ],
    "suggestAcceptance": true
  },
  {
    "id": "dao-dissolution-policy",
    "revision": "1.0.0",
    "title": "DAO Dissolution and Asset Distribution Policy",
    "purpose": "Set the process for closure, obligations and remaining assets.",
    "category": 1,
    "sourceFilename": "10-dao-dissolution-policy.md",
    "sourceSha256": "5bb944fcae8134be8df90642d0542f3263cef737de125f978202505c99fab41f",
    "guidance": "**Draft template:** A governance vote cannot replace mandatory legal liquidation procedures or create member entitlement to residual assets.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      },
      {
        "key": "DISSOLUTION_THRESHOLD",
        "label": "Dissolution approval requirements",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "LEGAL_DISTRIBUTION_RULES",
        "label": "Rules for distribution after liabilities",
        "kind": "textarea",
        "maxLength": 8000
      }
    ],
    "suggestAcceptance": false
  },
  {
    "id": "delegation-authority-policy",
    "revision": "1.0.0",
    "title": "Delegation of Authority Policy",
    "purpose": "Record the limits and accountability of delegated authority.",
    "category": 1,
    "sourceFilename": "11-delegation-authority-policy.md",
    "sourceSha256": "23240c1577ff982c2e2e67b79d5d263fdb2f2f622fb011d9b3dba93e6b98c8c5",
    "guidance": "**Draft template:** Technical permissions, signing capabilities, and legal authority are different things. Check and align them for every delegation.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": false
  },
  {
    "id": "governance-amendment-document-control-policy",
    "revision": "1.0.0",
    "title": "Governance Amendment and Document Control Policy",
    "purpose": "Explain document hierarchy, approvals and amendment history.",
    "category": 1,
    "sourceFilename": "12-governance-amendment-document-control-policy.md",
    "sourceSha256": "294991aed1436bca29343a5ba7f0e64767ac20927912c162d7dd22434e03288a",
    "guidance": "**Draft template:** Check hierarchy against the DAO's actual legal structure and governing instruments.",
    "fields": [
      {
        "key": "DAO_NAME",
        "label": "DAO name",
        "kind": "text",
        "maxLength": 500
      },
      {
        "key": "EFFECTIVE_DATE",
        "label": "Proposed effective date",
        "kind": "date",
        "maxLength": 500
      }
    ],
    "suggestAcceptance": false
  }
];
export const legalTemplates: readonly LegalTemplate[] = Object.freeze(
  z.array(LegalTemplateSchema).length(12).parse(descriptors.map((entry) => ({
    ...entry, markdown: sources['./templates/' + entry.sourceFilename],
  }))),
);
