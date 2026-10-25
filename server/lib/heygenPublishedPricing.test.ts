import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HEYGEN_PRICE_URL, ECB_FX_URL, parseHeyGenPublishedPrice, parseHeyGenPublishedSpeechPrice, parseEcbUsdCny, readHeyGenPublishedTariff, verifyHeyGenPublishedTariff } from './heygenPublishedPricing.js';
import { createSocialContentTaskBudgetAuthority } from './socialContentTaskBudgetAuthority.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const row = (...cells: string[]) => ({ cells: cells.map(text => ({ content: [{ text }] })) });
const source = '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { articleContent: { articleId: '10060327', blocks: [{ rows: [
  row('Video Generation with Avatar IV engine', 'Price per 1 minute, charged by actual seconds generated', 'Credits per min'),
  row('Photo Avatar', '$2.31', '46'), row('Digital Twin', '$4.83', '97'), row('Studio Avatar', '$4.83', '97'),
  row('Video Generation with Avatar III engine', 'Price per 1 minute, charged by actual seconds generated', 'Credits per min'), row('Digital Twin', '$0.60', '12'),
] }] } } } }) + '</script>';
const fx = (day: string) => `<gesmes:Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time='${day}'><Cube currency='USD' rate='1.1206'/><Cube currency='CNY' rate='7.4992'/></Cube></Cube></gesmes:Envelope>`;
const credentialSha256 = hash('controlled-key');
const accountRef = 'heygen:' + hash(JSON.stringify({ baseUrl: 'https://api.heygen.com/v3/videos', credentialSha256 }));
const intent = { operationId: 'controlled-avatar', provider: 'heygen', model: 'avatar_iv', accountRef, stage: 'presenter_video', shotId: 'hook', inputContractHash: 'a'.repeat(64), maximumUnits: { providerSeconds: 5.6 } };
const now = new Date();
const day = now.toISOString().slice(0, 10);
const options = { now: () => now, readBinding: async () => ({ accountRef, credentialSha256, avatarType: 'digital_twin' as const, billingCurrency: 'USD' as const, billingEvidenceRef: 'verified-original-wallet-usd' }),
  fetchOfficial: async (url: string) => ({ url, status: 200, body: url === HEYGEN_PRICE_URL ? source : fx(day) }) };
test('engine and actual avatar class choose USD column; credits and cheaper engines cannot substitute', () => {
  assert.equal(parseHeyGenPublishedPrice(source, 'digital_twin'), 4.83);
  assert.equal(parseHeyGenPublishedPrice(source, 'photo_avatar'), 2.31);
  assert.equal(parseHeyGenPublishedPrice(source.replace('$4.83', '97'), 'digital_twin'), null);
});
test('ECB reference conversion requires both rates, a current date and no duplicate currencies', () => {
  assert.equal(parseEcbUsdCny(fx(day), now)?.cnyPerUsd, 7.4992 / 1.1206);
  assert.equal(parseEcbUsdCny(fx('2000-01-01'), now), null);
  assert.equal(parseEcbUsdCny(fx(day).replace("currency='CNY'", "currency='USD'"), now), null);
});
test('sourced FX estimate preserves USD identity and rejects changed rates, endpoint and account', async () => {
  const tariff = await readHeyGenPublishedTariff(intent, options); assert.ok(tariff);
  assert.equal(tariff.verifiedAccountPrice, false); assert.equal(tariff.pricingBasis, 'published_fx_estimate');
  assert.equal(verifyHeyGenPublishedTariff(tariff), true);
  assert.equal(verifyHeyGenPublishedTariff({ ...tariff, meters: { providerSeconds: { ...tariff.meters.providerSeconds!, priceCny: .01 } } }), false);
  assert.equal(await readHeyGenPublishedTariff({ ...intent, accountRef: 'foreign' }, options), null);
  assert.equal(await readHeyGenPublishedTariff(intent, { ...options, fetchOfficial: async url => ({ url: 'https://foreign.example', status: 200, body: url === HEYGEN_PRICE_URL ? source : fx(day) }) }), null);
  assert.equal(await readHeyGenPublishedTariff({ ...intent, stage: 'voice_alignment' }, options), null);
});
test('one film pool admits the sourced estimate and retains native price plus FX in its quote', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'heygen-price-estimate-'));
  try {
    const scope = { tenantId: 'tenant', taskId: 'task', runId: 'run', planHash: 'b'.repeat(64) };
    const tariff = await readHeyGenPublishedTariff(intent, options); assert.ok(tariff);
    const authority = createSocialContentTaskBudgetAuthority({ ledgerRoot: root, ports: { assertCurrent: async () => {}, verifyRejection: async () => false,
      readApprovedPlan: async () => ({ scope, authorizationRef: 'approximately-ten-cny', maximumCny: 10, paidOperations: [intent] }), readVerifiedTariff: async () => tariff } });
    const result = await authority.prepareAndReserve(scope), quote = result.quotes[intent.operationId]!;
    assert.equal(quote.nativePricing?.currency, 'USD'); assert.equal(quote.nativePricing?.usdPerMinute, 4.83);
    assert.equal(quote.nativePricing?.basis, 'published_fx_estimate');
    assert.ok(Math.abs(quote.upperBoundCny - 5.6 / 60 * 4.83 * 7.4992 / 1.1206) < .000002);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bound Starfish speech is priced by audio seconds using the official USD rate and account', async () => {
  const speechSource = source.replace('<script id="__NEXT_DATA__">', '<script id="__NEXT_DATA__">').replace('"rows":[', '"rows":[' + JSON.stringify(row('Speech — Starfish', '$0.12', '2')) + ',');
  assert.equal(parseHeyGenPublishedSpeechPrice(speechSource), .12);
  assert.equal(parseHeyGenPublishedSpeechPrice(source), null);
  const speechAccount = 'heygen:' + hash(JSON.stringify({baseUrl:'https://api.heygen.com/v3/voices/speech',credentialSha256}));
  const speechIntent = {...intent,model:'starfish',stage:'tts',accountRef:speechAccount,maximumUnits:{audioSeconds:40}};
  const tariff = await readHeyGenPublishedTariff(speechIntent, {...options,readBinding:async()=>({...await options.readBinding(),accountRef:speechAccount}),fetchOfficial:async url=>({url,status:200,body:url===HEYGEN_PRICE_URL?speechSource:fx(day)})});
  assert.ok(tariff); assert.equal(verifyHeyGenPublishedTariff(tariff),true);
  assert.equal(tariff.meters.audioSeconds?.unitsPerPrice,60);
  assert.equal(verifyHeyGenPublishedTariff({...tariff,accountRef}),false);
  assert.equal(verifyHeyGenPublishedTariff({...tariff,meters:{characters:tariff.meters.audioSeconds!}}),false);
});


test('Orca catalog speech never borrows the Starfish or cloned voice-model tariff', async () => {
  const speechSource = source.replace('"rows":[', '"rows":[' + [row('Model', 'Rate', 'Credits per min'), row('Speech — Starfish', '$0.12', '2'), row('Instant voice speech', '$15 per 1 million characters', '300 per 1 million characters')].map(r => JSON.stringify(r)).join(',') + ',');
  const speechAccount = 'heygen:' + hash(JSON.stringify({baseUrl:'https://api.heygen.com/v3/voices/speech',credentialSha256}));
  const orcaIntent = {...intent,model:'orca',stage:'tts',accountRef:speechAccount,maximumUnits:{audioSeconds:40}};
  const readBinding = async () => ({...await options.readBinding(),accountRef:speechAccount});
  const fetchOfficial = async (url: string) => ({url,status:200,body:url===HEYGEN_PRICE_URL?speechSource:fx(day)});
  assert.equal(parseHeyGenPublishedSpeechPrice(speechSource,'orca'),null);
  assert.equal(await readHeyGenPublishedTariff(orcaIntent,{...options,readBinding,fetchOfficial}),null);
  // Controlled future official-row fixture, not a currently published Orca price.
  const explicit = speechSource.replace('Speech — Starfish','Speech — Orca');
  const tariff = await readHeyGenPublishedTariff(orcaIntent,{...options,readBinding,fetchOfficial:async url=>({url,status:200,body:url===HEYGEN_PRICE_URL?explicit:fx(day)})});
  assert.ok(tariff); assert.equal(tariff.model,'orca'); assert.equal(verifyHeyGenPublishedTariff(tariff),true);
  assert.equal(parseHeyGenPublishedSpeechPrice(explicit.replace('Credits per min','Credits per character'),'orca'),null);
  assert.equal(verifyHeyGenPublishedTariff({...tariff,model:'starfish'}),false);
  assert.equal(verifyHeyGenPublishedTariff({...tariff,meters:{characters:tariff.meters.audioSeconds!}}),false);
});


test('native Avatar IV mother-track speech prices the whole voiced video, never extracted audio seconds', async () => {
  const mother = {...intent,stage:'tts',maximumUnits:{providerSeconds:76}};
  const tariff = await readHeyGenPublishedTariff(mother,options);
  assert.ok(tariff); assert.equal(tariff.stage,'tts'); assert.equal(tariff.model,'avatar_iv');
  assert.equal(tariff.meters.providerSeconds?.unitsPerPrice,60);
  assert.equal(verifyHeyGenPublishedTariff(tariff),true);
  assert.equal(await readHeyGenPublishedTariff({...mother,maximumUnits:{audioSeconds:76}},options),null);
  assert.equal(await readHeyGenPublishedTariff({...mother,maximumUnits:{providerSeconds:76,audioSeconds:76}},options),null);
  const speechAccount = 'heygen:' + hash(JSON.stringify({baseUrl:'https://api.heygen.com/v3/voices/speech',credentialSha256}));
  assert.equal(await readHeyGenPublishedTariff({...mother,accountRef:speechAccount},options),null);
  assert.equal(verifyHeyGenPublishedTariff({...tariff,accountRef:speechAccount}),false);
  assert.equal(verifyHeyGenPublishedTariff({...tariff,meters:{audioSeconds:tariff.meters.providerSeconds!}}),false);
  assert.equal(verifyHeyGenPublishedTariff({...tariff,stage:'voice_alignment'}),false);
});

test('native avatar-id mother track uses the verified provider class; opaque IDs and TTS stage do not imply studio', async () => {
  const mother = {...intent,stage:'tts',maximumUnits:{providerSeconds:76}};
  for (const [avatarType, usdPerMinute] of [['photo_avatar',2.31],['studio_avatar',4.83]] as const) {
    const tariff=await readHeyGenPublishedTariff(mother,{...options,readBinding:async()=>({...await options.readBinding(),avatarType})});
    assert.ok(tariff);assert.equal(verifyHeyGenPublishedTariff(tariff),true);
    assert.equal(tariff.meters.providerSeconds?.priceCny,usdPerMinute*(7.4992/1.1206));
    assert.equal(tariff.meters.providerSeconds?.unitsPerPrice,60);
  }
});
