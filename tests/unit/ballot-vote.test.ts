import { expect, it } from 'vitest';
import { ABI, Serializer } from '@wharfkit/antelope';
import { ballotCommitment, decideAbi, encodeDecide, DecideActionSchemas } from '@daclify/modules/sdk';
import { ModuleStateSchema } from '@daclify/modules';
import { Uint64Schema, type DaoRef } from '@daclify/core-protocol';
import { z } from 'zod';
import { prepareBallotVote } from '@daclify/modules/sdk';

const dao: DaoRef = {chainId:'ab'.repeat(32),contract:'daclifycore',daoId:'1',interfaceVersion:1};
const fixture = ModuleStateSchema.parse({dao,modules:[],ballots:[{id:'1',dao_id:'1',creator:'1',kind:0,choices:2,closes:1300,quorum:5000,approval:5001,denominator:'3',max_member:'3',cast:'0',tallies:['0','0'],status:0,winner:-1,metadata:JSON.stringify({schemaVersion:3,semantics:'poll',title:'Location',description:'Choose a venue.',options:['Garden','Hall']})}],votes:[],projects:[],milestones:[],schedules:[],entries:[],controls:[],ballotDefinitions:[{ballot_id:'1',dao_id:'1',version:1,purpose:1,policy_revision:'0',policy_hash:'00'.repeat(32),commitment:'00'.repeat(32)}]});
const ballot = fixture.ballots[0], definition = fixture.ballotDefinitions[0];
if(!ballot||!definition)throw Error('Fixture');
const hash = ballotCommitment({chainId:dao.chainId,runtime:dao.contract,decide:'decide',ballot,definition});
const definitions = [{...definition,commitment:hash}];
const input = {dao,decide:'decide',memberId:'2',ballot,definitions,choice:0};
const ids = {dao_id:z.coerce.string().pipe(Uint64Schema),member_id:z.coerce.string().pipe(Uint64Schema),ballot_id:z.coerce.string().pipe(Uint64Schema)};

it('signs the computed binding and exact selection for new ballots', () => {
  const result = prepareBallotVote(input);
  expect(result.action).toBe('votecommit');
  expect(DecideActionSchemas.votecommit.extend(ids).parse(JSON.parse(JSON.stringify(Serializer.decode({abi:ABI.from(decideAbi),type:result.action,data:encodeDecide(result.action,result.fields)}))))).toEqual({runtime:'daclifycore',dao_id:'1',member_id:'2',ballot_id:'1',choice:0,expected:hash});
});
it('refuses forged text before constructing a signing payload', () => {
  expect(()=>prepareBallotVote({...input,ballot:{...ballot,metadata:ballot.metadata.replace('Location','Treasury')}})).toThrow('BALLOT_DEFINITION_CHANGED');
});
it('refuses a missing new binding and foreign-domain markers', () => {
  expect(()=>prepareBallotVote({...input,definitions:[]})).toThrow('BALLOT_DEFINITION_REQUIRED');
  expect(()=>prepareBallotVote({...input,dao:{...dao,daoId:'2'}})).toThrow('DAO_REFERENCE');
  expect(()=>prepareBallotVote({...input,definitions:[{...definition,commitment:hash,dao_id:'2'}]})).toThrow();
});
it('preserves the original signature path for legacy definitions', () => {
  const result = prepareBallotVote({...input,definitions:[],ballot:{...ballot,metadata:'{}'}});
  expect(result.action).toBe('vote');
  expect(DecideActionSchemas.vote.extend(ids).parse(JSON.parse(JSON.stringify(Serializer.decode({abi:ABI.from(decideAbi),type:'vote',data:encodeDecide(result.action,result.fields)}))))).toMatchObject({ballot_id:'1',member_id:'2',choice:0});
});
