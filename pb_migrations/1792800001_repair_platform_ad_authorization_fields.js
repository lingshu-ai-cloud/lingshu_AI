/// <reference path="../pb_data/types.d.ts" />
// PocketBase FieldsList.getByName returns null when absent. Earlier field-only
// migrations expected an exception; repair those omissions without changing
// their applied checksums or any records, credentials, or historical metadata.
migrate((app) => {
  const definitions = [
    ['platform_ad_connections', [
      ['authorization', 'json'], ['defaultPage', 'json'], ['businessName', 'text'],
      ['accountStatus', 'number'], ['timezoneId', 'number'], ['timezoneName', 'text'],
      ['timezoneOffsetHoursUtc', 'number'], ['resourceSyncRunId', 'text'], ['resourceSyncedAt', 'text'],
    ]],
    ['platform_ad_oauth_states', [['authorization', 'json'], ['context', 'text'], ['appId', 'text'], ['providerUserId', 'text']]],
  ];
  for (const [collectionIndex, [name, fields]] of definitions.entries()) {
    const collection = app.findCollectionByNameOrId(name);
    for (const [fieldIndex, [fieldName, type]] of fields.entries()) {
      const previous = collection.fields.getByName(fieldName);
      if (previous) {
        const previousType = typeof previous.type === 'function' ? previous.type() : previous.type;
        if (previousType !== type) throw new Error(`${name}.${fieldName} must be ${type}`);
        continue;
      }
      collection.fields.addAt(collection.fields.length, new Field({ id: `padfix_${collectionIndex}_${fieldIndex}`, name: fieldName, type, required: false }));
    }
    app.save(collection);
  }
}, () => {
  // Repair is additive and may adopt existing fields. Do not erase credentials
  // or metadata on rollback; the owning original migrations define removal.
});
