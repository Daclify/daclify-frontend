import { expect,it } from 'vitest';
import { readDocumentForReview } from '../../src/content/document-review';
import { sha256Hex } from '../../src/auth/vault';
import { DaoContentSchema } from '@daclify/core-protocol';
const dao={chainId:'ab'.repeat(32),contract:'daclifycore',daoId:'1',interfaceVersion:1 as const};
const records=DaoContentSchema.parse({dao,members:[],keyGrants:[],epochs:[],documents:[]});
it('reads exact verified inline bytes and rejects altered data or a foreign DAO',async()=>{
 const metadata='{"title":"Original terms"}',doc={id:'1',document_id:'42',version:1,author:'1',cid:'',metadata,bytes:new TextEncoder().encode(metadata).length,commitment:await sha256Hex(new TextEncoder().encode(metadata)),envelope_version:0,key_epoch:'0'};
 expect(await readDocumentForReview(dao,undefined,doc,records)).toEqual({text:metadata});
 await expect(readDocumentForReview(dao,undefined,{...doc,metadata:'{}'},records)).rejects.toThrow('DOCUMENT_INTEGRITY');
 await expect(readDocumentForReview({...dao,daoId:'2'},undefined,doc,records)).rejects.toThrow('DAO_REFERENCE');
 await expect(readDocumentForReview(dao,undefined,{...doc,envelope_version:1},records)).rejects.toThrow('EPOCH_UNAVAILABLE');
});
