import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ABI,
  Blob as ChainBlob,
  Checksum256,
  PackedTransaction,
  PrivateKey,
  Serializer,
  Signature,
  Transaction,
} from '@wharfkit/antelope';
import { NativeFinishSchema, NativeSignInMessageSchema } from '@daclify/core-protocol';
import { encodeAction } from '@daclify/core-protocol/sdk';
import { telosDecideAbi } from '@daclify/modules/sdk';
import { TelosBallotSchema } from '@daclify/modules';
import { createHash } from 'node:crypto';
import { resourceInfo } from '../fixtures/resource-rpc';
const chainId = 'ab'.repeat(32),
  key = PrivateKey.generate('K1'),
  abi = ABI.from(telosDecideAbi),
  bytes = Serializer.encode({ object: abi });
const source = {
  chainId,
  rpcUrl: 'https://telos-fixture.example.test',
  contract: 'telos.decide',
  environment: 'testnet',
  codeHash: 'cd'.repeat(32),
  abiHash: Checksum256.hash(bytes.array).toString(),
};
const active = TelosBallotSchema.parse({
  ballot_name: 'election1',
  category: 'election',
  publisher: 'publisher',
  status: 'voting',
  title: 'Council election',
  description: 'Choose a representative',
  content: 'javascript:alert(1)',
  treasury_symbol: '4,VOTE',
  voting_method: '1token1vote',
  min_options: 1,
  max_options: 1,
  options: [
    { key: 'yes', value: '0.0000 VOTE' },
    { key: 'no', value: '0.0000 VOTE' },
  ],
  total_voters: 0,
  total_delegates: 0,
  total_raw_weight: '0.0000 VOTE',
  cleaned_count: 0,
  settings: [
    { key: 'revotable', value: 1 },
    { key: 'votestake', value: 1 },
  ],
  begin_time: '2020-01-01T00:00:00',
  end_time: '2090-01-01T00:00:00',
});
async function fixture(
  page: Page,
  signing = true,
  behavior: {
    newVoter?: boolean;
    lostBroadcast?: boolean;
    pauseBroadcast?: boolean;
    pauseChallenge?: boolean;
    pending?: boolean;
  } = {},
) {
  let challengeRequested = false;
  let resume: () => void = () => {};
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let session = false,
    challenge = '',
    signupCount = 0,
    broadcasts = 0;
  const account = {
    id: '33da81fc-c2a1-44f0-a1d1-30baf901db25',
    custody: 'user-controlled',
    signingKey: null,
    encryptionKey: null,
    walletOrigin: 'signup',
  };
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (url.hostname === 'telos-fixture.example.test') {
      if (path.endsWith('get_info')) return route.fulfill({ json: resourceInfo });
      if (path.endsWith('get_raw_abi'))
        return route.fulfill({
          json: {
            account_name: 'telos.decide',
            code_hash: source.codeHash,
            abi_hash: source.abiHash,
            abi: new ChainBlob(bytes.array).toString(),
          },
        });
      if (path.endsWith('push_transaction')) {
        const packed = PackedTransaction.from(route.request().postDataJSON()),
          transaction = packed.getTransaction();
        broadcasts++;
        expect(
          transaction.actions.map((a) => [
            a.account.toString(),
            a.name.toString(),
            a.authorization[0]?.toString(),
          ]),
        ).toEqual(
          behavior.newVoter
            ? [
                ['telos.decide', 'regvoter', 'alice@active'],
                ['telos.decide', 'castvote', 'alice@active'],
              ]
            : [['telos.decide', 'castvote', 'alice@active']],
        );
        if (behavior.pauseBroadcast) await paused;
        if (behavior.lostBroadcast) return route.abort('failed');
        return route.fulfill({
          json: {
            transaction_id: transaction.id.toString(),
            processed: {
              id: transaction.id.toString(),
              block_num: 1,
              block_time: '2026-10-11T12:00:00',
              receipt: { status: 'executed', cpu_usage_us: 1, net_usage_words: 1 },
              elapsed: 1,
              net_usage: 1,
              scheduled: false,
              action_traces: [],
              account_ram_delta: null,
            },
          },
        });
      }
      if (path.endsWith('get_transaction_status'))
        return route.fulfill({
          json: {
            state: behavior.pending ? 'LOCALLY_APPLIED' : 'IRREVERSIBLE',
            head_number: 100,
            head_id: 'ab'.repeat(32),
            head_timestamp: '2026-10-11T12:00:00',
            irreversible_number: 90,
            irreversible_id: 'ab'.repeat(32),
            irreversible_timestamp: '2026-10-11T12:00:00',
            earliest_tracked_block_id: 'ab'.repeat(32),
            earliest_tracked_block_number: 1,
          },
        });
    }
    if (path === '/v1/network')
      return route.fulfill({
        json: {
          chainId,
          rpcUrl: source.rpcUrl,
          runtime: 'daclifycore',
          hub: null,
          environment: 'testnet',
          interfaceVersion: 1,
          coreVersion: '0.14.0-alpha.1',
          capabilities: [],
        },
      });
    if (path === '/v1/daos') return route.fulfill({ json: { daos: [] } });
    if (path === '/v1/me')
      return route.fulfill(
        session ? { json: { account } } : { status: 401, json: { code: 'AUTH_REQUIRED' } },
      );
    if (path === '/v1/me/memberships') return route.fulfill({ json: { memberships: [] } });
    if (path === '/v1/telos/ballots')
      return route.fulfill({
        json: {
          source,
          ballots: [
            active,
            {
              ...active,
              ballot_name: 'pastelection',
              title: 'Past council election',
              status: 'closed',
              end_time: '2020-02-01T00:00:00',
            },
          ],
          nextCursor: null,
          observedAt: new Date().toISOString(),
          signingAvailable: signing,
        },
      });
    if (path === '/v1/telos/ballots/pastelection')
      return route.fulfill({
        json: {
          source,
          ballot: {
            ...active,
            ballot_name: 'pastelection',
            title: 'Past council election',
            status: 'closed',
            end_time: '2020-02-01T00:00:00',
          },
          signingAvailable: signing,
          observedAt: new Date().toISOString(),
        },
      });
    if (path === '/v1/telos/ballots/election1')
      return route.fulfill({
        json: {
          source,
          ballot: active,
          signingAvailable: signing,
          observedAt: new Date().toISOString(),
        },
      });
    if (path === '/v1/telos/votes/prepare')
      return route.fulfill({
        json: {
          source,
          ballot: active,
          voter: {
            account: 'alice',
            registered: !behavior.newVoter,
            weight: behavior.newVoter ? null : '10.0000 VOTE',
            alreadyVoted: false,
          },
          options: route.request().postDataJSON().options,
          expires: new Date(Date.now() + 60000).toISOString(),
        },
      });
    if (path === '/v1/account/native/challenge') {
      const body = route.request().postDataJSON();
      expect(body.purpose).toBe('signup');
      const id = crypto.randomUUID(),
        expires = new Date(Date.now() + 300000).toISOString();
      challengeRequested = true;
      if (behavior.pauseChallenge) await paused;
      challenge = JSON.stringify(
        NativeSignInMessageSchema.parse({
          domain: 'daclify.native-sign-in.v2',
          purpose: 'signup',
          origin: new URL(page.url()).origin,
          audience: url.origin,
          accountId: null,
          identity: { chainId, account: 'alice', permission: 'active' },
          runtime: 'daclifycore',
          id,
          expires,
        }),
      );
      return route.fulfill({
        json: {
          id,
          message: challenge,
          expires,
          identity: { chainId, account: 'alice', permission: 'active' },
          runtime: 'daclifycore',
        },
      });
    }
    if (path === '/v1/sign-up/native') {
      const proof = NativeFinishSchema.parse(route.request().postDataJSON()).proof,
        transaction = Serializer.decode({ type: Transaction, data: proof.packedTransaction });
      expect(transaction.actions).toHaveLength(1);
      expect(transaction.actions[0]?.data.toString()).toBe(
        Buffer.from(
          encodeAction('authproof', {
            account: 'alice',
            intent: createHash('sha256').update(challenge).digest('hex'),
          }),
        ).toString('hex'),
      );
      expect(
        Signature.from(proof.signatures[0] ?? '')
          .recoverDigest(transaction.signingDigest(chainId))
          .toString(),
      ).toBe(key.toPublic().toString());
      expect(transaction.actions[0]?.account.toString()).toBe('daclifycore');
      session = true;
      signupCount++;
      return route.fulfill({ json: { account, csrfToken: 'a'.repeat(43) } });
    }
    return route.fulfill({ status: 404, json: { code: 'UNEXPECTED_FIXTURE_ROUTE' } });
  });
  return {
    resume,
    challenged: () => challengeRequested,
    counts: () => ({ signupCount, broadcasts }),
    install: () =>
      page.evaluate(async (value) => {
        const path = '/tests/fixtures/telos-wallet-browser.ts';
        const fixture = await import(path);
        fixture.installTelosWallet(value);
      }, key.toString()),
  };
}
test('public history and active elections need no account and reject unsafe content links', async ({
  page,
}) => {
  const flow = await fixture(page);
  await page.goto('/telos');
  await expect(page.getByRole('heading', { name: 'Telos governance', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Past council election', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Council election', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Ballot content' })).toHaveCount(0);
  await expect(page.getByRole('main')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([]);
  expect(flow.counts()).toEqual({ signupCount: 0, broadcasts: 0 });
});
test('first native vote verifies signup and casts the external vote without DAO membership', async ({
  page,
}) => {
  const flow = await fixture(page);
  await page.goto('/telos');
  await page.getByRole('button', { name: 'Council election', exact: true }).click();
  await flow.install();
  await page.getByLabel('yes', { exact: true }).check();
  await expect(
    page.getByText(
      'Continuing creates or opens your Daclify account paired with this Telos Zero wallet.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Vote with Telos Zero', exact: true }).click();
  await expect(page.getByText('Vote confirmed.', { exact: true })).toBeVisible();
  expect(flow.counts()).toEqual({ signupCount: 1, broadcasts: 1 });
  await expect(page.getByRole('link', { name: 'Explore other DAOs' })).toBeVisible();
});
test('read-only connections keep history available without offering a vote', async ({ page }) => {
  const flow = await fixture(page, false);
  await page.goto('/telos');
  await page.getByRole('button', { name: 'Council election', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Vote with Telos Zero', exact: true }),
  ).toBeDisabled();
  expect(flow.counts()).toEqual({ signupCount: 0, broadcasts: 0 });
});

test('an uncertain broadcast survives reload and blocks resubmission', async ({ page }) => {
  const flow = await fixture(page, true, { lostBroadcast: true, pending: true });
  await page.goto('/telos?ballot=election1');
  await flow.install();
  await page.getByLabel('yes', { exact: true }).check();
  await page.getByRole('button', { name: 'Vote with Telos Zero', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Pending vote' })).toBeVisible();
  const id = await page.getByRole('region', { name: 'Pending vote' }).locator('code').innerText();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Pending vote' }).locator('code')).toHaveText(id);
  await expect(
    page.getByRole('button', { name: 'Vote with Telos Zero', exact: true }),
  ).toBeDisabled();
  expect(flow.counts().broadcasts).toBe(1);
});
test('navigation during broadcast retains the reference for its original ballot', async ({
  page,
}) => {
  const flow = await fixture(page, true, { pauseBroadcast: true, pending: true });
  await page.goto('/telos?ballot=election1');
  await flow.install();
  await page.getByLabel('yes', { exact: true }).check();
  await page.getByRole('button', { name: 'Vote with Telos Zero', exact: true }).click();
  await expect.poll(() => flow.counts().broadcasts).toBe(1);
  await expect(page.getByRole('region', { name: 'Pending vote' })).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, '', '/telos?ballot=pastelection');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(
    page.getByRole('heading', { name: 'Past council election', exact: true }),
  ).toBeVisible();
  flow.resume();
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys(sessionStorage).some((key) => key.endsWith(':election1'))),
    )
    .toBe(true);
  await page.goto('/telos?ballot=election1');
  await expect(page.getByRole('region', { name: 'Pending vote' })).toBeVisible();
  expect(flow.counts().broadcasts).toBe(1);
});

test('an ended voting period is provisional history with no enabled vote', async ({ page }) => {
  const ended = { ...active, title: '', end_time: '2020-02-01T00:00:00' };
  await fixture(page);
  await page.route('**/v1/telos/ballots/election1', (route) =>
    route.fulfill({
      json: { source, ballot: ended, signingAvailable: true, observedAt: new Date().toISOString() },
    }),
  );
  await page.goto('/telos?ballot=election1');
  await expect(page.getByRole('heading', { name: 'election1', exact: true })).toBeVisible();
  await expect(
    page.getByText('These recorded totals await ballot closure.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Vote with Telos Zero', exact: true }),
  ).toBeDisabled();
});

test('account switching during signup stops the vote journey', async ({ page }) => {
  const flow = await fixture(page, true, { pauseChallenge: true });
  await page.goto('/telos?ballot=election1');
  await flow.install();
  await page.getByLabel('yes', { exact: true }).check();
  await page.getByRole('button', { name: 'Vote with Telos Zero', exact: true }).click();
  await expect.poll(flow.challenged).toBe(true);
  await page.evaluate(async () => {
    const path = '/src/state/workspace.ts';
    const { useWorkspace } = await import(path);
    useWorkspace().account = {
      id: '55da81fc-c2a1-44f0-a1d1-30baf901db25',
      custody: 'user-controlled',
      signingKey: null,
      encryptionKey: null,
    };
  });
  flow.resume();
  await expect(page.locator('.telos-governance').getByRole('alert')).toContainText('changed');
  expect(flow.counts()).toEqual({ signupCount: 0, broadcasts: 0 });
});

test('a first Decide vote registers and casts atomically in one signed transaction', async ({
  page,
}) => {
  const flow = await fixture(page, true, { newVoter: true });
  await page.goto('/telos?ballot=election1');
  await flow.install();
  await page.getByLabel('yes', { exact: true }).check();
  await page.getByRole('button', { name: 'Vote with Telos Zero', exact: true }).click();
  await expect(page.getByText('Vote confirmed.', { exact: true })).toBeVisible();
  expect(flow.counts()).toEqual({ signupCount: 1, broadcasts: 1 });
});
