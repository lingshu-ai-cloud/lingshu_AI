/// <reference path="../pb_data/types.d.ts" />
// Forward-only: zero attempts/capacity and empty initial evidence are legitimate.
// Application admission remains responsible for provider/review readiness.
migrate((app) => {
  for (const [name, fields] of [
    ["content_execution_jobs", ["attempt", "reconciliation_attempt", "provider_receipts"]],
    ["content_execution_limits", ["max_running"]],
    ["studio_social_presenter_jobs", ["visual_control"]]
  ]) {
    const collection = app.findCollectionByNameOrId(name);
    for (const name of fields) collection.fields.getByName(name).required = false;
    app.save(collection);
  }
}, (app) => {
  throw new Error("forward_only_zero_state_contract: restoring required would reject legitimate stored zero/empty values");
});
