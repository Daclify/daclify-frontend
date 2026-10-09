import {
  Vote,
  Coins,
  WalletCards,
  MessageCircle,
  Flag,
  Sprout,
  UsersRound,
  CalendarDays,
  Banknote,
} from '@lucide/vue';
import type { Component } from 'vue';
export const toolGuides: Record<
  string,
  { icon: Component; example: string; steps: string[]; requirements: string; limits: string }
> = {
  'member-vote': {
    icon: Vote,
    example: 'A neighborhood DAO chooses which community event to organize next.',
    steps: [
      'An administrator opens a ballot with options, a closing time and agreed thresholds.',
      'Each eligible member casts one vote. The eligible membership is frozen for the ballot.',
      'After closing, finalize the result. Funding and execution require their own approved flow.',
    ],
    requirements: 'An active voting membership and the Decide module.',
    limits:
      'Members excluded from voting cannot vote. A passed ordinary ballot is advisory; it cannot execute arbitrary transactions.',
  },
  'credit-vote': {
    icon: Coins,
    example:
      'A contributor collective gives more influence to members with earned governance credits.',
    steps: [
      'Agree how credits are issued before opening voting.',
      'Create a credit-weighted ballot using the DAO’s governance policy.',
      'Eligible members vote; finalize after closing to calculate the result.',
    ],
    requirements: 'DAO-specific internal credits, eligible members and Decide.',
    limits:
      'Credits are internal governance units. Issuance and other weight-changing operations are locked during an active ballot.',
  },
  'stake-vote': {
    icon: WalletCards,
    example: 'A token community lets members vote using tokens they have deposited with its DAO.',
    steps: [
      'Members deposit the DAO’s configured native token into governance stake.',
      'An administrator opens a stake-weighted ballot; its eligible denominator is frozen.',
      'Members cast votes, then finalize after the deadline. Stake exits reopen when governance locks are released.',
    ],
    requirements: 'A configured native governance asset, deposited stake and Decide.',
    limits:
      'A wallet balance alone gives no stake voting power. Deposits and stake changes freeze during an open ballot. Tokens remain governed by the DAO’s configured native asset.',
  },
  'advisory-poll': {
    icon: MessageCircle,
    example: 'Ask your members whether a new module would be useful before committing money.',
    steps: [
      'Pick member, credit or deposited-stake voting and publish a clear question.',
      'Let eligible members vote during the agreed period.',
      'Finalize and discuss the outcome before making a separate authorized commitment.',
    ],
    requirements: 'Decide and a voting policy matching the DAO.',
    limits: 'An advisory poll does not reserve Treasury funds or create a payable obligation.',
  },
  'milestone-work': {
    icon: Flag,
    example: 'Fund a website redesign in three milestones, reviewed before each payment.',
    steps: [
      'Publish deliverables, a contributor and up to sixteen funded milestones.',
      'An administrator or configured funding vote accepts the proposal and reserves its funds.',
      'The contributor submits evidence; another authorized reviewer approves or requests changes.',
      'Settle approved obligations and withdraw claims separately through Treasury.',
    ],
    requirements: 'Works, a funded DAO treasury, a contributor and an independent reviewer.',
    limits:
      'Contributors cannot approve their own work. Cancelling work preserves approved liabilities. No dispute arbitration is implemented.',
  },
  'grant-round': {
    icon: Sprout,
    example:
      'A community invites project applications and votes on awards under published deadlines.',
    steps: [
      'Freeze round rules, eligibility, award cap and application/review/award deadlines.',
      'Applicants submit exact proposal versions and contribution terms; administrators review eligibility.',
      'A Decide award vote pins the application revision. Execute a passed finalized award before its cutoff.',
      'Works reserves and tracks the award’s milestones, review and settlement.',
    ],
    requirements: 'Grants rounds, Decide, Works and sufficient DAO treasury funds for each award.',
    limits:
      'The cap reserves no money. Matching pools and donor pots are not implemented. Editing an application invalidates its earlier review and vote.',
  },
  'member-endorsement': {
    icon: UsersRound,
    example: 'A member-sponsored community asks existing members to endorse applicants.',
    steps: [
      'An administrator explicitly enables endorsement admission and its threshold.',
      'A member sponsors the applicant’s verified public join identity and document version.',
      'Distinct eligible members endorse that exact application revision.',
      'Admit once the current policy and threshold pass; grant private content access separately.',
    ],
    requirements: 'Endorsement admission, a configured threshold and existing eligible sponsors.',
    limits:
      'Endorsements do not prove unique personhood. Admission grants ordinary membership, never administrator powers, credits or document keys.',
  },
  salary: {
    icon: CalendarDays,
    example: 'Approve six monthly installments for a community coordinator.',
    steps: [
      'Choose a contributor, native-token amount, future UTC start date and interval.',
      'Fund and commit a fixed term of up to twelve installments.',
      'Settle due installments; future installments wait for their due times.',
    ],
    requirements: 'Payroll, a valid contributor and funding for the entire term.',
    limits:
      'Renewal needs a new funded commitment. Disabling the module or offboarding a member does not cancel already approved liabilities.',
  },
  'one-time': {
    icon: Banknote,
    example: 'Schedule a single funded honorarium for a contributor.',
    steps: [
      'Select a contributor, a native-token amount and a future due time.',
      'Commit one funded installment.',
      'Settle once due, then let the recipient withdraw their Treasury claim.',
    ],
    requirements: 'Payroll and enough treasury backing for one installment.',
    limits:
      'The schedule does not renew. Settlement and withdrawal are distinct actions; retries cannot create a duplicate payout.',
  },
};
