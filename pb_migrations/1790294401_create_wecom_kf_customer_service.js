/// <reference path="../pb_data/types.d.ts" />

// Server-only durable state for the WeCom "微信客服" callback, sync, review
// and outbound pipeline. Every externally supplied identifier is unique only
// inside a tenant boundary.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required });
  const bool = (name, required = false) => ({ name, type: "bool", required });
  const json = (name, required = false) => ({ name, type: "json", required });
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const specs = [
    {
      name: "wecom_kf_callbacks",
      fields: [
        text("tenant_id", true), text("callback_key", true), text("open_kfid"),
        text("status", true), text("sync_token_cipher"), text("token_expires_at"),
        text("received_at", true), text("processed_at"), text("updated_at", true), text("error")
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_wecom_kf_callback_key ON wecom_kf_callbacks (tenant_id, callback_key)"
      ]
    },
    {
      name: "wecom_kf_sync_states",
      fields: [
        text("tenant_id", true), text("open_kfid", true), text("cursor"),
        text("last_synced_at"), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_wecom_kf_sync_state ON wecom_kf_sync_states (tenant_id, open_kfid)"
      ]
    },
    {
      name: "wecom_kf_conversations",
      fields: [
        text("tenant_id", true), text("conversation_key", true), text("open_kfid", true),
        text("external_userid", true), text("status", true), number("service_state"),
        text("servicer_userid"), text("last_inbound_at"), text("last_message_at"),
        text("last_message_preview"), bool("human_required"), text("handoff_reason"),
        text("handed_off_by"), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_wecom_kf_conversation_key ON wecom_kf_conversations (tenant_id, conversation_key)",
        "CREATE INDEX idx_wecom_kf_conversation_queue ON wecom_kf_conversations (tenant_id, status, last_message_at)"
      ]
    },
    {
      name: "wecom_kf_messages",
      fields: [
        text("tenant_id", true), text("conversation_id"), text("provider_msg_id", true),
        text("open_kfid"), text("external_userid"), text("direction", true),
        number("origin"), text("msg_type"), text("event_type"), text("content"),
        text("sent_at", true), json("raw_payload"), text("created_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_wecom_kf_message_id ON wecom_kf_messages (tenant_id, provider_msg_id)",
        "CREATE INDEX idx_wecom_kf_message_timeline ON wecom_kf_messages (tenant_id, conversation_id, sent_at)"
      ]
    },
    {
      name: "wecom_kf_drafts",
      fields: [
        text("tenant_id", true), text("conversation_id", true), text("content", true),
        text("risk_level", true), bool("requires_human_review"), json("risk_reasons"),
        text("status", true), text("created_by", true), text("created_at", true),
        text("updated_at", true)
      ],
      indexes: [
        "CREATE INDEX idx_wecom_kf_draft_conversation ON wecom_kf_drafts (tenant_id, conversation_id, created_at)"
      ]
    },
    {
      name: "wecom_kf_outbounds",
      fields: [
        text("tenant_id", true), text("conversation_id", true), text("draft_id", true),
        text("caller_key", true), text("client_idempotency_key", true),
        text("provider_msg_id", true), text("window_key", true), number("send_slot", true),
        text("status", true), bool("human_approved"),
        text("reviewed_by"), text("failure_code"), text("failure_reason"),
        text("created_by", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_wecom_kf_outbound_caller ON wecom_kf_outbounds (tenant_id, caller_key)",
        "CREATE UNIQUE INDEX idx_wecom_kf_outbound_msg ON wecom_kf_outbounds (tenant_id, provider_msg_id)",
        "CREATE UNIQUE INDEX idx_wecom_kf_outbound_window_slot ON wecom_kf_outbounds (tenant_id, conversation_id, window_key, send_slot)",
        "CREATE INDEX idx_wecom_kf_outbound_conversation ON wecom_kf_outbounds (tenant_id, conversation_id, created_at)"
      ]
    }
  ];

  const findCollection = (name) => {
    try { return app.findCollectionByNameOrId(name); } catch { return null; }
  };
  const findField = (collection, name) => {
    try { return collection.fields.getByName(name); } catch { return null; }
  };
  let result;
  for (let collectionIndex = 0; collectionIndex < specs.length; collectionIndex += 1) {
    const spec = specs[collectionIndex];
    let collection = findCollection(spec.name);
    if (!collection) {
      collection = new Collection({
        name: spec.name,
        type: "base",
        system: false,
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [id(), ...spec.fields],
        indexes: spec.indexes
      });
    } else {
      for (let fieldIndex = 0; fieldIndex < spec.fields.length; fieldIndex += 1) {
        const definition = spec.fields[fieldIndex];
        const existing = findField(collection, definition.name);
        if (!existing) {
          collection.fields.addAt(collection.fields.length, new Field({
            id: `wcs_${String(collectionIndex).padStart(2, "0")}_${String(fieldIndex).padStart(2, "0")}`,
            ...definition
          }));
        } else if (existing.type !== definition.type) {
          throw new Error(`${spec.name}.${definition.name} must be ${definition.type}, found ${existing.type}`);
        }
      }
      const indexes = collection.indexes || [];
      collection.indexes = [...indexes, ...spec.indexes.filter(index => !indexes.includes(index))];
    }
    result = app.save(collection);
  }
  return result;
}, (app) => {
  const names = [
    "wecom_kf_outbounds", "wecom_kf_drafts", "wecom_kf_messages",
    "wecom_kf_conversations", "wecom_kf_sync_states", "wecom_kf_callbacks"
  ];
  let result;
  for (const name of names) {
    try { result = app.delete(app.findCollectionByNameOrId(name)); } catch {}
  }
  return result;
});
