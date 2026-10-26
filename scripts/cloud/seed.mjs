// This fixture loader cannot select a local/private database from .env.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

assert.equal(process.env.AI_SETTER_CLOUD_SANDBOX, "disposable", "Use scripts/cloud/run.sh");
assert.equal(process.env.DATABASE_URL, "postgresql://cloud_fixture@127.0.0.1:55432/ai_setter_cloud");
const fixture = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const org = fixture.organization.id;
const stage = "stg_cloud_fixture_new";
try {
  const [db] = await sql`select current_database() as name, current_user as role`;
  assert.equal(db.name, "ai_setter_cloud");
  assert.equal(db.role, "cloud_fixture");
  const unexpected = await sql`select id from organization where id <> ${org}`;
  assert.equal(unexpected.length, 0, "Refusing to seed a database with foreign organizations");
  await sql.begin(async (tx) => {
    await tx`insert into organization (id, name, slug) values (${org}, ${fixture.organization.name}, ${fixture.organization.slug}) on conflict (id) do nothing`;
    await tx`insert into pipeline_stage (id, organization_id, name, position, kind) values (${stage}, ${org}, 'Nuevo', 0, 'open') on conflict (id) do nothing`;
    await tx`insert into agent_profile (id, organization_id, enabled, name, tone, instructions) values ('ap_cloud_fixture', ${org}, false, ${fixture.agent.name}, ${fixture.agent.tone}, ${fixture.agent.instructions}) on conflict (id) do nothing`;
    for (const [index, entry] of fixture.kb.entries()) {
      await tx`insert into kb_entry (id, organization_id, kind, question, answer) values (${`kb_cloud_fixture_${index}`}, ${org}, 'qa', ${entry.question}, ${entry.answer}) on conflict (id) do nothing`;
    }
    for (const lead of fixture.leads) {
      const contact = `ct_cloud_fixture_${lead.key}`;
      const leadId = `ld_cloud_fixture_${lead.key}`;
      const conversation = `cv_cloud_fixture_${lead.key}`;
      const at = new Date("2026-01-01T12:00:00Z");
      await tx`insert into contact (id, organization_id, wa_identity, name, name_source, source, ficha) values (${contact}, ${org}, ${`sim:${contact}`}, ${lead.name}, 'manual', ${lead.source}, ${tx.json(lead.ficha)}) on conflict (id) do nothing`;
      await tx`insert into lead (id, organization_id, contact_id, stage_id) values (${leadId}, ${org}, ${contact}, ${stage}) on conflict (id) do nothing`;
      await tx`insert into lead_stage_event (id, organization_id, lead_id, contact_id, to_stage_id, to_stage_name, to_stage_kind, source, occurred_at) values (${`lse_cloud_fixture_${lead.key}`}, ${org}, ${leadId}, ${contact}, ${stage}, 'Nuevo', 'open', 'sistema', ${at}) on conflict (id) do nothing`;
      await tx`insert into conversation (id, organization_id, contact_id, is_test, ai_enabled, last_inbound_at, last_message_at) values (${conversation}, ${org}, ${contact}, true, true, ${lead.messages.length ? at : null}, ${lead.messages.length ? at : null}) on conflict (id) do nothing`;
      for (const [index, text] of lead.messages.entries()) {
        await tx`insert into message (id, organization_id, conversation_id, direction, type, text, status, wa_timestamp, created_at) values (${`msg_cloud_fixture_${lead.key}_${index}`}, ${org}, ${conversation}, 'in', 'text', ${text}, 'delivered', ${at}, ${at}) on conflict (id) do nothing`;
      }
    }
  });
  const [counts] = await sql`
    select
      (select count(*)::int from contact where organization_id = ${org}) as contacts,
      (select count(*)::int from lead where organization_id = ${org}) as leads,
      (select count(*)::int from conversation where organization_id = ${org}) as conversations,
      (select count(*)::int from conversation where organization_id = ${org} and not is_test) as real_conversations,
      (select count(*)::int from kb_entry where organization_id = ${org}) as kb,
      (select count(*)::int from message where organization_id = ${org}) as messages,
      (select count(*)::int from agent_profile where organization_id = ${org} and not enabled) as disabled_profiles,
      (select count(*)::int from meta_credentials) as meta_credentials`;
  assert.deepEqual(counts, { contacts: 2, leads: 2, conversations: 2, real_conversations: 0, kb: 2, messages: 1, disabled_profiles: 1, meta_credentials: 0 });
  console.log("[cloud-seed] Synthetic fixture counts verified; no real conversations or Meta credentials.");
} finally {
  await sql.end();
}
