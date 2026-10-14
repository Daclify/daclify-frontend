import { expect, it } from 'vitest';
import { ServiceOfferDocumentSchema } from '@daclify/modules';
import { serviceOfferValue } from '../../src/content/service-offer';
const dao={chainId:'ab'.repeat(32),contract:'daclifycore',daoId:'1',interfaceVersion:1 as const};
it('creates a validated offer for this member and full DAO reference', () => {
  const value=serviceOfferValue({dao,memberId:'2',title:' Garden care ',summary:' Weekly visits ',skills:'Pruning\nWatering\n'});
  expect(ServiceOfferDocumentSchema.parse(JSON.parse(value))).toEqual({schemaVersion:1,type:'service-offer',dao,memberId:'2',title:'Garden care',summary:'Weekly visits',skills:['Pruning','Watering']});
});
it('rejects blank descriptions, repeated skills and oversized stored text', () => {
  const input={dao,memberId:'2',title:'Care',summary:'Visits',skills:''};
  expect(()=>serviceOfferValue({...input,title:' '})).toThrow();
  expect(()=>serviceOfferValue({...input,skills:'Pruning\npruning'})).toThrow('SERVICE_SKILLS_DUPLICATE');
  expect(()=>serviceOfferValue({...input,summary:'園'.repeat(1000),skills:Array.from({length:16},(_,index)=>index+'花'.repeat(40)).join('\n')})).toThrow('SERVICE_OFFER_SIZE');
});
