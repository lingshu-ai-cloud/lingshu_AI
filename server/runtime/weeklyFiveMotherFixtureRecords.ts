import assert from 'node:assert/strict';
export function fixtureObject(value:unknown):Record<string,unknown>{
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'fixture record must be an object');
 return value as Record<string,unknown>;
}
export function fixtureMetrics(value:unknown):Record<'views'|'likes'|'shares'|'comments',number>{
 const object=fixtureObject(value);
 for(const key of ['views','likes','shares','comments'] as const)assert.ok(typeof object[key]==='number'&&Number.isFinite(object[key]),`fixture requires numeric ${key}`);
 return object as Record<'views'|'likes'|'shares'|'comments',number>;
}
