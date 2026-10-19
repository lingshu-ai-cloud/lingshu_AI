/// <reference path="../pb_data/types.d.ts" />

// Forward-only durable state for technical and creative weekly repair. These
// records authorize production, preserve provider/evaluation lineage and may
// outlive the weekly package that created them.
migrate((app) => {
  const id = () => ({
    name: 'id', type: 'text', system: true, required: true, primaryKey: true,
    autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$',
  });
  const text = (name, required = false) => ({ name, type: 'text', required });
  const number = (name) => ({ name, type: 'number', required: true, onlyInt: true, min: 1 });
  const hash = (name) => ({ name, type: 'text', required: true, min: 64, max: 64, pattern: '^[a-f0-9]{64}$' });
  const payload = () => ({ name: 'payload', type: 'json', required: true, maxSize: 8388608 });
  const save = (name, fields, indexes) => app.save(new Collection({
    name, type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields, payload()], indexes,
  }));

  save('social_weekly_production_repair_cases', [
    text('tenant_id', true), text('program_id', true), text('package_id', true), number('package_version'),
    text('publication_task_id', true), text('case_id', true), hash('subject_hash'), text('request_id', true),
    text('state', true), hash('content_hash'),
  ], [
    'CREATE UNIQUE INDEX idx_weekly_repair_case_identity ON social_weekly_production_repair_cases (tenant_id, case_id)',
    'CREATE INDEX idx_weekly_repair_case_subject ON social_weekly_production_repair_cases (tenant_id, subject_hash, state)',
    'CREATE INDEX idx_weekly_repair_case_package ON social_weekly_production_repair_cases (tenant_id, program_id, package_id, package_version)',
  ]);

  save('social_weekly_creative_repair_configurations', [
    text('tenant_id', true), text('case_id', true), hash('content_hash'),
  ], [
    'CREATE UNIQUE INDEX idx_weekly_creative_repair_configuration ON social_weekly_creative_repair_configurations (tenant_id, case_id)',
  ]);

  save('social_weekly_creative_repair_capacity_reservations', [
    text('tenant_id', true), text('case_id', true), text('reservation_id', true), hash('content_hash'),
  ], [
    'CREATE UNIQUE INDEX idx_weekly_creative_repair_capacity_case ON social_weekly_creative_repair_capacity_reservations (tenant_id, case_id)',
    'CREATE UNIQUE INDEX idx_weekly_creative_repair_capacity_id ON social_weekly_creative_repair_capacity_reservations (tenant_id, reservation_id)',
  ]);

  save('social_weekly_creative_repair_child_executions', [
    text('tenant_id', true), text('case_id', true), text('state', true), hash('content_hash'),
  ], [
    'CREATE UNIQUE INDEX idx_weekly_creative_repair_child_case ON social_weekly_creative_repair_child_executions (tenant_id, case_id)',
  ]);

  save('social_weekly_creative_repair_stage_evidence', [
    text('tenant_id', true), text('task_id', true), text('case_id', true), text('step', true), hash('content_hash'),
  ], [
    'CREATE UNIQUE INDEX idx_weekly_creative_repair_stage_task ON social_weekly_creative_repair_stage_evidence (tenant_id, task_id)',
    'CREATE INDEX idx_weekly_creative_repair_stage_case ON social_weekly_creative_repair_stage_evidence (tenant_id, case_id, step)',
  ]);

  save('social_weekly_creative_repair_audits', [
    text('tenant_id', true), text('program_id', true), text('package_id', true), number('package_version'),
    text('case_id', true), hash('content_hash'),
  ], [
    'CREATE UNIQUE INDEX idx_weekly_creative_repair_audit_case ON social_weekly_creative_repair_audits (tenant_id, case_id)',
    'CREATE INDEX idx_weekly_creative_repair_audit_package ON social_weekly_creative_repair_audits (tenant_id, program_id, package_id, package_version)',
  ]);
}, () => {
  throw new Error('weekly repair records are durable execution evidence; rollback requires an explicitly reviewed forward migration');
});
