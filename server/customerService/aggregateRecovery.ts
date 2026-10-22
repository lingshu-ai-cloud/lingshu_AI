import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export async function readCompleteRows<T extends Record_>(store: DataStore, collection: string, where: Record<string, string | number>): Promise<T[]> {
  const all: T[] = []; let expected: number | undefined;
  for (let page = 1; page <= 1000; page++) {
    const r = await store.list<T>(collection, { where, page, perPage: 250, sort: 'id' });
    if (!Number.isSafeInteger(r.totalItems) || expected !== undefined && expected !== r.totalItems) throw Error('customer_aggregate_read_changed');
    expected = r.totalItems; all.push(...r.items);
    if (all.length === expected && new Set(all.map(v => v.id)).size === all.length) return all;
    if (!r.items.length || all.length > expected) break;
  }
  throw Error('customer_aggregate_read_incomplete');
}
export function buildManifest(children: Record<string, unknown>[]) {
  if (Buffer.byteLength(JSON.stringify(children)) > 430_000) throw Error('customer_aggregate_scope_too_large');
  return { version: 1, children, hash: socialRequestHash(children) };
}
/** Parent remains building until all frozen children are durable. Retry never calls the generator again. */
export async function completeAggregate<T extends Record_, C extends Record_>(store: DataStore, parent: T, input: {
  collection: string; children: string; foreignKey: string; metadata: string; finalStatus: string;
}): Promise<{ parent: T; children: C[] }> {
  const meta = object(parent[input.metadata]), manifest = object(meta.buildManifest);
  const planned = manifest.children;
  const childId=(index:number)=>createHash('sha256').update(`${input.collection}:${parent.id}:${index}`).digest('hex').slice(0,15);
  const verifyChild=(child:C,payload:Record<string,unknown>)=>{
    if(child.tenant_id!==parent.tenant_id||child[input.foreignKey]!==parent.id)throw Error('customer_aggregate_child_scope_mismatch');
    const keys=Object.keys(payload).filter(key=>payload[key]!==undefined);
    if(socialRequestHash(Object.fromEntries(keys.map(key=>[key,child[key]])))!==socialRequestHash(payload))throw Error('customer_aggregate_child_content_changed');
  };
  if (parent.status === 'building') {
    if (!Array.isArray(planned) || manifest.hash !== socialRequestHash(planned)) throw Error('customer_aggregate_manifest_invalid');
    for (let i = 0; i < planned.length; i++) {
      const payload = { ...object(planned[i]), [input.foreignKey]: parent.id };
      const id = childId(i);
      const existing = await store.getById<C>(input.children, id);
      if(existing)verifyChild(existing,payload);
      if (!existing) {
        const created = await store.create<C>(input.children, { ...payload, id });
        if (!created) {
          const recovered = await store.getById<C>(input.children, id);
          if (!recovered || recovered.tenant_id !== parent.tenant_id || recovered[input.foreignKey] !== parent.id) throw Error('customer_aggregate_child_write_failed');
          verifyChild(recovered,payload);
        }
      }
    }
  }
  const children = await readCompleteRows<C>(store, input.children, { tenant_id: String(parent.tenant_id), [input.foreignKey]: parent.id });
  const expected = input.collection === 'customer_segments' ? Number(parent.member_count) + Number(parent.excluded_count) : Number(object(parent.counts).total);
  if (Number.isFinite(expected) && children.length !== expected) throw Error('customer_aggregate_incomplete');
  // Batch item status/receipts legitimately advance after publication; segment snapshots stay immutable.
  if(Array.isArray(planned)&&(parent.status==='building'||input.collection==='customer_segments')){
    if(manifest.hash!==socialRequestHash(planned)||children.length!==planned.length)throw Error('customer_aggregate_manifest_invalid');
    const byId=new Map(children.map(child=>[child.id,child]));
    for(let i=0;i<planned.length;i++){
      const child=byId.get(childId(i));if(!child)throw Error('customer_aggregate_incomplete');
      verifyChild(child,{...object(planned[i]),[input.foreignKey]:parent.id});
    }
  }
  if(parent.status==='building'){
    if (!await store.update(input.collection, parent.id, { status: input.finalStatus })) throw Error('customer_aggregate_completion_write_failed');
    parent = { ...parent, status: input.finalStatus };
  }
  return { parent, children };
}
