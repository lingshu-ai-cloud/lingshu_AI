/** Offline contract checks only. No provider calls, credentials, or runtime authorization. */
const text = v => typeof v === 'string' && v.trim().length > 0;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const date = v => typeof v === 'string' ? Date.parse(v) : NaN;
const version = v => Number.isSafeInteger(v) && v > 0;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const forbidden = value => object(value) && Object.entries(value).some(([key,v]) => /^(access_?token|refresh_?token|client_?secret|authorization|password)$/i.test(key) || (object(v) && forbidden(v)) || (Array.isArray(v) && v.some(forbidden)));
function base(input,kind) {
 const checks=[]; const check=(code,passed)=>checks.push({code,passed:passed===true});
 const s=input?.scope,a=input?.account,now=date(input?.now);
 check('input_object',!!object(input));check('secrets_not_supplied',!forbidden(input));
 check('scope_complete',!!object(s)&&text(s.tenantId)&&text(s.accountId)&&version(s.accountVersion)&&hash(s.accountIdentityHash));
 check('account_scope_bound',!!object(a)&&!!s&&['tenantId','accountId','accountVersion','accountIdentityHash'].every(k=>a[k]===s[k]));
 check('account_connected',a?.status==='connected');check('native_account_present',text(a?.providerAccountId));
 check('clock_explicit',Number.isFinite(now));
 check('token_reference_only',hash(a?.tokenRef)&&date(a?.tokenExpiresAt)>now);
 check('scopes_complete',Array.isArray(a?.scopes)&&a.scopes.every(text)&&new Set(a.scopes).size===a.scopes.length);
 const finish=missing=>({status:missing?'missing':checks.every(c=>c.passed)?'missing':'failed',checks,summary:{kind,dryRun:true,providerVerified:false,platform:['instagram','facebook','tiktok','youtube'].includes(a?.platform)?a.platform:'unknown',checkCount:checks.length,failedCheckCount:checks.filter(c=>!c.passed).length}});
 return {s,a,now,check,finish};
}
function instagramContract(a,check,publishing) {
 const ig=a?.oauthProvider==='instagram_login',fb=a?.oauthProvider==='facebook_login';
 check('instagram_oauth_provider',ig||fb);
 check('instagram_token_host',ig?a.tokenKind==='instagram_user'&&a.graphHost==='https://graph.instagram.com':fb&&a.tokenKind==='facebook_page'&&a.graphHost==='https://graph.facebook.com'&&text(a.parentPageId));
 const required=ig?['instagram_business_basic',publishing?'instagram_business_content_publish':'instagram_business_manage_messages']:[publishing?'instagram_content_publish':'instagram_manage_messages'];
 check('instagram_required_permissions',Array.isArray(a?.scopes)&&required.every(v=>a.scopes.includes(v)));
}
export function validateInstagramEvidence(input) {
 const {s,a,now,check,finish}=base(input,'instagram');
 check('instagram_platform',a?.platform==='instagram');instagramContract(a,check,false);
 const p=input?.professionalAccount,r=input?.recipient;
 check('professional_provider_read',p?.source==='provider_read'&&p?.provider==='meta'&&['BUSINESS','MEDIA_CREATOR'].includes(p?.accountType)&&text(p?.receiptRef)&&hash(p?.rawReceiptHash)&&date(p?.observedAt)<=now&&now-date(p?.observedAt)<=30*60_000);
 check('professional_identity_bound',!!p&&!!s&&['tenantId','accountId','accountVersion','accountIdentityHash'].every(k=>p[k]===s[k])&&p.providerAccountId===a?.providerAccountId);
 check('recipient_signed_inbound',r?.source==='signed_webhook'&&r?.verifiedSignature===true&&hash(r?.signedBodyHash)&&hash(r?.eventHash)&&text(r?.inboundMessageId)&&text(r?.recipientId)&&r?.direction==='inbound');
 check('recipient_identity_bound',!!r&&!!s&&['tenantId','accountId','accountVersion','accountIdentityHash'].every(k=>r[k]===s[k])&&r.providerAccountId===a?.providerAccountId);
 check('recipient_response_window',date(r?.inboundAt)<=now&&now-date(r?.inboundAt)<=24*60*60_000);
 return finish(!input||!s||!a||!p||!r);
}
export function validatePublicationEvidence(input) {
 const {s,a,now,check,finish}=base(input,'publication');
 const platform=a?.platform;check('publication_platform',['instagram','facebook','tiktok','youtube'].includes(platform));
 if(platform==='instagram')instagramContract(a,check,true);
 else {const required=platform==='tiktok'?'video.publish':platform==='facebook'?'pages_manage_posts':'https://www.googleapis.com/auth/youtube.upload';check('publication_permission',Array.isArray(a?.scopes)&&a.scopes.includes(required));}
 const rows=input?.capabilityReceipts;
 check('capability_receipts_array',Array.isArray(rows));
 for(const capability of ['publishing.official','publishing.receipt_lookup']) {
  // Runtime provider-probe receipt lookup is TikTok-specific. Other platforms use native token authority.
  if(capability==='publishing.receipt_lookup'&&platform!=='tiktok')continue;
  const matches=Array.isArray(rows)?rows.filter(r=>r?.capability===capability):[];const r=matches[0];
  check(`${capability}:unique`,matches.length===1);
  check(`${capability}:scope`,!!r&&r.tenant_id===s?.tenantId&&r.account_id===s?.accountId&&r.platform===platform&&r.account_version===s?.accountVersion&&r.account_identity_hash===s?.accountIdentityHash);
  const verified=date(r?.verified_at),expiry=date(r?.expires_at);
  check(`${capability}:current_provider_probe`,r?.status==='verified'&&r?.evidence_source==='provider_probe'&&verified<=now+60_000&&now-verified<=30*60_000&&expiry>now&&expiry<=verified+16*60_000&&hash(r?.raw_receipt_hash)&&text(r?.receipt_ref));
  check(`${capability}:reference`,text(r?.evidence_ref)&&r.evidence_ref.startsWith(`provider:${platform}:`)&&(capability!=='publishing.receipt_lookup'||(text(input?.receiptId)&&r.evidence_ref===`provider:tiktok:receipt:${input.receiptId}`&&r.provider_receipt_id===input.receiptId)));
 }
 return finish(!input||!s||!a||!Array.isArray(rows)||rows.length===0);
}
