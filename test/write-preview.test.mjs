import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWritePreviews } from '../lib/write-previews.mjs';
process.env.YNAB_MCP_NO_AUTOSTART = '1';
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = '1';
process.env.YNAB_API_TOKEN = 'fake-preview-test-token';
const { createFsJournal, transactionUpdateMismatches } = await import('../index.js');
const plan = { tool:'update_transactions', budget:'fake-budget', ids:['fake-row'], before:{amount:-2,category:'fake-food',memo:'Untrusted fixture'}, after:{category:'fake-travel'} };

test('previews expire, bind exact state and become single-use on stale or failed preparation', () => {
  let clock = 1000;
  const manager = createWritePreviews({tenantId:'fake-tenant',sessionId:'fake-session',ttlMs:100,now:()=>clock});
  const expired = manager.issue(plan); clock += 100;
  assert.throws(()=>manager.consume(expired.preview_token,plan),/expired/);
  const stale = manager.issue(plan);
  assert.throws(()=>manager.consume(stale.preview_token,{...plan,ids:['different-row']}),/Stale preview/);
  assert.throws(()=>manager.consume(stale.preview_token,plan),/already used/);
  const failed = manager.issue(plan); const validate = manager.claim(failed.preview_token);
  assert.throws(()=>manager.claim(failed.preview_token),/already used/);
  clock += 100; assert.throws(()=>validate(plan),/expired while/);
});

test('preview capability cannot move to another tenant/session or altered values', () => {
  const first = createWritePreviews({tenantId:'a',sessionId:'one'});
  const second = createWritePreviews({tenantId:'b',sessionId:'one'});
  const token = first.issue(plan).preview_token;
  assert.throws(()=>second.consume(token,plan),/another authenticated session/);
  assert.throws(()=>first.consume(token,{...plan,after:{category:'different'}}),/Stale/);
});

test('split readback validates count, exact amount and requested category independently of generated IDs/order', () => {
  const requested={subtransactions:[{amount:-2,categoryId:'food'},{amount:-3,memo:'fake'}]};
  assert.deepEqual(transactionUpdateMismatches(requested,{subtransactions:[{id:'b',amount:-3,memo:'fake'},{id:'a',amount:-2,category_id:'food'}]}),[]);
  assert.equal(transactionUpdateMismatches(requested,{subtransactions:[{amount:-2,category_id:'wrong'},{amount:-3,memo:'fake'}]})[0].field,'subtransactions');
  assert.equal(transactionUpdateMismatches(requested,{subtransactions:[]})[0].field,'subtransactions');
});

test('file journal fails closed on corruption and independent adapters atomically retain concurrent entries', async t => {
  const dir=mkdtempSync(join(tmpdir(),'ynab-synthetic-journal-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'journal.json'); const a=createFsJournal(file), b=createFsJournal(file);
  await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).mutate(entries=>{entries.unshift({id:`fake-${i}`});})));
  assert.equal((await a.read()).length,20);
  if(process.platform!=='win32') assert.equal(statSync(file).mode & 0o777,0o600);
  writeFileSync(file,'{broken synthetic journal');
  await assert.rejects(a.read(),/JSON|position|Expected/);
  await assert.rejects(a.mutate(entries=>entries.unshift({id:'never'})),/JSON|position|Expected/);
  assert.equal(readFileSync(file,'utf8'),'{broken synthetic journal');
});
