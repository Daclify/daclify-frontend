import { expect, it } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';
import { documentReferenceLocation } from '../../src/content/document-reference';
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div />'}}]});
it('links exact document bytes and a local return path', () => {
  const location=documentReferenceLocation({daoId:'1',documentId:'42',version:3,commitment:'ab'.repeat(32),returnTo:'/dao/1/works'});
  if(!location)throw Error('Missing reference');
  const href=new URL(router.resolve(location).href,'https://app.example');
  expect(href.pathname).toBe('/dao/1/documents');
  expect(Object.fromEntries(href.searchParams)).toEqual({document:'42',version:'3',commitment:'ab'.repeat(32),returnTo:'/dao/1/works'});
});
it('leaves unavailable or malformed references unlinked rather than choosing the latest version', () => {
  expect(documentReferenceLocation({daoId:'1',documentId:'42',version:3})).toBeUndefined();
  expect(documentReferenceLocation({daoId:'1',documentId:'bad',version:3,commitment:'ab'.repeat(32)})).toBeUndefined();
});
it('rejects external and foreign-DAO return paths', () => {
  for(const returnTo of ['https://foreign.example','/dao/2/works','/dao/1/../2/works'])
    expect(documentReferenceLocation({daoId:'1',documentId:'42',version:3,commitment:'ab'.repeat(32),returnTo})?.query).not.toHaveProperty('returnTo');
});
