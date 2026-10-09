migrate((app) => {
  const accounts = app.findCollectionByNameOrId('social_accounts');
  accounts.fields.addAt(accounts.fields.length, new Field({
    name: 'oauthProvider',
    type: 'text',
    required: false,
    pattern: '^(instagram_login|facebook_login)$',
  }));
  accounts.fields.addAt(accounts.fields.length, new Field({
    name: 'instagramWebhookSubscribed',
    type: 'bool',
    required: false,
  }));
  accounts.fields.addAt(accounts.fields.length, new Field({
    name: 'instagramWebhookSubscriptionError',
    type: 'text',
    required: false,
    max: 2000,
  }));
  app.save(accounts);
}, (app) => {
  const accounts = app.findCollectionByNameOrId('social_accounts');
  for (const name of ['oauthProvider', 'instagramWebhookSubscribed', 'instagramWebhookSubscriptionError']) {
    let field;
    try { field = accounts.fields.getByName(name); } catch {}
    if (field) accounts.fields.removeById(field.id);
  }
  app.save(accounts);
});
