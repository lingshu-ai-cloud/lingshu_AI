/// <reference path="../pb_data/types.d.ts" />
// Additive metadata only. Does not modify grants, account IDs, plans or receipts.
migrate((app) => {
  for (const [name, definitions] of [
    ['platform_ad_connections', [['authorization', 'json']]],
    ['platform_ad_oauth_states', [['authorization', 'json'], ['context', 'text'], ['appId', 'text'], ['providerUserId', 'text']]],
  ]) {
    const collection = app.findCollectionByNameOrId(name);
    for (const [fieldName, type] of definitions) {
      try { collection.fields.getByName(fieldName); }
      catch { collection.fields.addAt(collection.fields.length, new Field({ id: ({ authorization: 'pad_authmeta', context: 'pad_authctx', appId: 'pad_authapp', providerUserId: 'pad_authuser' })[fieldName], name: fieldName, type, required: false })); }
    }
    app.save(collection);
  }
  let requests;
  try { requests = app.findCollectionByNameOrId('platform_ad_privacy_requests'); }
  catch {
    requests = new Collection({ name: 'platform_ad_privacy_requests', type: 'base', fields: [
      ...['confirmationCodeHash', 'providerUserId', 'appId', 'status', 'requestedAt', 'requestFingerprint', 'issuedAt'].map(name => ({ name, type: 'text', required: false })),
      { name: 'tenantIds', type: 'json', required: false },
    ] });
  }
  const index = 'CREATE UNIQUE INDEX idx_platform_ad_privacy_request ON platform_ad_privacy_requests (requestFingerprint)';
  requests.indexes = [...(requests.indexes || []).filter(value => value !== index), index];
  app.save(requests);
}, (app) => {
  for (const [name, fields] of [
    ['platform_ad_connections', ['authorization']],
    ['platform_ad_oauth_states', ['authorization', 'context', 'appId', 'providerUserId']],
  ]) {
    const collection = app.findCollectionByNameOrId(name);
    for (const name of fields) { try { collection.fields.removeById(collection.fields.getByName(name).id); } catch {} }
    app.save(collection);
  }
  try { app.delete(app.findCollectionByNameOrId('platform_ad_privacy_requests')); } catch {}
});
