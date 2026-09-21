/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const spec = {
    type: 'base', name: 'studio_presenter_assets',
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'request_id', type: 'text', required: true },
      { name: 'kind', type: 'select', required: true, values: ['upload', 'creation'], maxSelect: 1 },
      { name: 'payload', type: 'json', required: true, maxSize: 2000000 },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_presenter_request ON studio_presenter_assets (tenant_id, kind, request_id)'],
  };
  let collection;
  try { collection = app.findCollectionByNameOrId(spec.name); } catch {}
  if (!collection) collection = new Collection(spec);
  else {
    for (const definition of spec.fields) {
      let field;
      try { field = collection.fields.getByName(definition.name); } catch {}
      if (!field) collection.fields.addAt(collection.fields.length, new Field(definition));
      else {
        if (field.type !== definition.type) throw new Error(`Unexpected field type: ${definition.name}`);
        field.required = true;
      }
    }
    for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) collection[rule] = null;
    collection.indexes = [...collection.indexes.filter(index => !index.includes('idx_presenter_request')), ...spec.indexes];
  }
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId('studio_presenter_assets')));
