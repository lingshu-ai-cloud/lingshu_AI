import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { socialMvpHandoffFixture } from '../../../shared/contracts/socialMvpHandoff.fixture';
import SocialMvpHandoffPanel from './SocialMvpHandoffPanel';
import { mvpMoney, mvpReviewLabel, socialMvpWorkbenchRead } from '../../lib/socialMvpWorkbench';

test('missing authority remains unverified with no fabricated costs or human approval', () => {
  const html = renderToStaticMarkup(<SocialMvpHandoffPanel value={null} expected={{taskId:'original'}} />);
  assert.match(html, /冻结执行包未核验/);
  assert.match(html, /最终内部人工审核：未核验/);
  assert.doesNotMatch(html, /0\.00|记录为通过|<button|<input/);
  assert.equal(mvpMoney(null), '未核验');
  assert.equal(mvpMoney(undefined), '未核验');
  assert.equal(mvpMoney(0), 'CNY 0.00', 'an explicit ledger zero differs from missing data');
});

test('existing workbench presentation shows exact frozen identities and receipts', () => {
  const f = socialMvpHandoffFixture();
  const value = {package:f.package,clips:[f.A,f.B],estimatedCosts:{A:null,B:null,total:null},gaps:[]};
  const html = renderToStaticMarkup(<SocialMvpHandoffPanel value={value} expected={f.package.scope} />);
  for (const identity of Object.values(f.package.scope)) assert.ok(html.includes(identity));
  for (const identity of [f.package.reference.sha256,f.package.avatar.version,f.package.voice.version,f.A.inputFingerprint,f.A.provider.receiptRef.id,f.A.cost.ledgerRef.id]) assert.ok(html.includes(identity));
  assert.ok(html.includes(mvpMoney(f.A.cost.actual, f.A.cost.currency)));
  assert.match(html, /预算上限不作为预估或实际费用/);
  assert.match(html, /最终内部人工审核：未核验/);
});

test('every editor scope mismatch suppresses foreign evidence', () => {
  const f = socialMvpHandoffFixture();
  const value = {package:f.package,clips:[f.A],gaps:[]};
  for (const key of Object.keys(f.package.scope)) {
    const expected = {...f.package.scope,[key]:'other'};
    assert.throws(()=>socialMvpWorkbenchRead(value, expected), /不一致/);
    const html = renderToStaticMarkup(<SocialMvpHandoffPanel value={value} expected={expected} />);
    assert.match(html, /身份不一致/);
    assert.ok(!html.includes(f.A.provider.receiptRef.id));
  }
});

test('a reservation never presents its actual zero as settled spending', () => {
  const f = socialMvpHandoffFixture();
  f.A.cost={...f.A.cost,state:'reserved',actual:0,reserved:1};
  const html=renderToStaticMarkup(<SocialMvpHandoffPanel value={{package:f.package,clips:[f.A],gaps:[]}} expected={f.package.scope}/>);
  assert.match(html, /预占 CNY 1\.00 · 实际 未核验/);
});

test('humanConfirmed or an agent signoff cannot manufacture final internal human review', () => {
  assert.equal(mvpReviewLabel({humanConfirmed:true,status:'passed'},true),'未核验');
  assert.equal(mvpReviewLabel({status:'passed',recordRef:'r',source:'agent',reviewerId:'agent',reviewedAt:'2026-10-11T00:00:00Z'},true),'未核验');
  assert.equal(mvpReviewLabel({status:'passed',recordRef:'r',source:'internal_human',reviewerId:'business-reviewer',reviewedAt:'2026-10-11T00:00:00Z'},true),'记录为通过');
  const html=renderToStaticMarkup(<SocialMvpHandoffPanel value={{package:null,clips:[],gaps:[],reviews:{finalInternalHuman:{status:'passed',recordRef:'unbound',source:'internal_human',reviewerId:'business-reviewer',reviewedAt:'2026-10-11T00:00:00Z'}}}} expected={{taskId:'original'}}/>);
  assert.match(html,/最终内部人工审核：未核验/);
  assert.doesNotMatch(html,/business-reviewer|记录为通过/);
});

test('missing receipts, changed fingerprints and duplicate scene handoffs fail closed', () => {
  const f=socialMvpHandoffFixture();
  for(const clips of [[{...f.A,provider:{...f.A.provider,receiptRef:null}}],[{...f.A,inputFingerprint:'f'.repeat(64)}],[f.A,f.A]]) {
    const html=renderToStaticMarkup(<SocialMvpHandoffPanel value={{package:f.package,clips,gaps:[]}} expected={f.package.scope}/>);
    assert.match(html,/未核验/);
    assert.ok(!html.includes(f.A.provider.taskId));
  }
});

test('a scoped server review record is shown separately from agent preliminary review', () => {
  const f=socialMvpHandoffFixture();
  const value={package:f.package,clips:[f.A,f.B],gaps:[],reviews:{technical:{status:'passed',recordRef:'tech'},creativePreliminary:{status:'changes_requested',recordRef:'creative'},finalInternalHuman:{status:'passed',recordRef:'human-record',source:'internal_human',reviewerId:'internal-reviewer',reviewedAt:'2026-10-11T01:00:00Z'}}};
  const html=renderToStaticMarkup(<SocialMvpHandoffPanel value={value} expected={f.package.scope}/>);
  assert.match(html,/技术检查：记录为通过/);
  assert.match(html,/独立创意初审：记录为需要修改/);
  assert.match(html,/最终内部人工审核：记录为通过/);
  assert.match(html,/internal-reviewer/);
  assert.doesNotMatch(html,/<button|<input|humanConfirmed/);
});
