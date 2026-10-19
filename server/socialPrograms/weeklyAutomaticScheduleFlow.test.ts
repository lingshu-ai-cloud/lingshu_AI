import assert from 'node:assert/strict';
import test from 'node:test';
import type {DataStore} from '../storage/datastore.js';
import {uniqueApprovedWeeklyDiscoveryAuthority} from './weeklyAutomaticScheduleFlow.js';

function store(payload:unknown):DataStore{
 return {async list(){return {items:[{id:'scope',tenant_id:'tenant',status:'active',version:3,payload}],totalItems:1,totalPages:1,page:1,perPage:20};}} as unknown as DataStore;
}

test('approved five-video account revision binds only account mode, never inherited keyword modes',async()=>{
 const accountUrl='https://www.tiktok.com/@fixture_factory';
 const payload={approval:{status:'approved',scopeVersion:3},weeklyAccountRevision:{accountUrl,targetCount:5},discoveryBrief:{weeklyAccountCollectionTarget:{accountUrl,targetCount:5},discoveryModes:['momentum','account','innovation'],modePolicies:{account:{enabled:true},momentum:{enabled:true},innovation:{enabled:true}}}};
 assert.deepEqual(await uniqueApprovedWeeklyDiscoveryAuthority(store(payload),'tenant'),{scopeId:'scope',scopeVersion:3,requestedModes:['account']});
 assert.equal(await uniqueApprovedWeeklyDiscoveryAuthority(store({...payload,weeklyAccountRevision:{accountUrl,targetCount:6}}),'tenant'),null);
 assert.equal(await uniqueApprovedWeeklyDiscoveryAuthority(store({...payload,discoveryBrief:{...payload.discoveryBrief,weeklyAccountCollectionTarget:{accountUrl:'https://www.tiktok.com/@other',targetCount:5}}}),'tenant'),null);
 assert.deepEqual(await uniqueApprovedWeeklyDiscoveryAuthority(store({approval:{status:'approved',scopeVersion:3},discoveryBrief:{discoveryModes:['momentum','innovation']}}),'tenant'),{scopeId:'scope',scopeVersion:3,requestedModes:['momentum','innovation']});
});
