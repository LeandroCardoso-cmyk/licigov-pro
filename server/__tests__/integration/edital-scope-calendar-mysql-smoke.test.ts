/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Rodada consolidada — MySQL REAL, dados SINTÉTICOS, pelas MESMAS rotas da tela.
 *  S1  C2: escopo do Edital escolhido antes da 1ª geração é registrado (fato `edital.scope`, fonte user), relido após "recarregar",
 *      idempotente, com CAS (conflito sem sobrescrever) e evento na linha do tempo; viewer não registra; outro órgão ⇒ NOT_FOUND
 *  S2  C2: a fronteira do Edital usa o escopo registrado quando não há parâmetros persistidos (resolução do modelo deixa de pedir)
 *  S3  C3: data da sessão declarada no registro governado do processo aparece no calendário/painel; processo de outro órgão,
 *      inativo ou sem data não aparece; evento cadastrado do mesmo dia prevalece; nada é gravado pela leitura
 * Só roda com DATABASE_URL. Nenhum dado real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { departmentOperationRouter } from "../../routers/departmentOperationRouter";
import { runMigrations, validateSchema } from "../../bootstrap";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { insertProcess } from "../../db/procurement";
import { recordHumanDecision } from "../../services/institutionalTemplates/decisionRecorder";
import { GOVERNED_FIELDS_SCHEMA, encodeGovernedPayload } from "../../domain/institutionalTemplates/governedSources";
import { makeContext, mockUser } from "../helpers/fixtures";
import { cleanupOrgs, ctxOf, decision, publishBllModel, seedWorld } from "../helpers/institutionalTemplatesE2eWorld";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";

const DB = process.env.DATABASE_URL;
const STAMP = Date.now() % 1_000_000;
// Faixa PRÓPRIA deste arquivo: [995.000.000, 995.200.000).
const BASE_ORG = 995_000_000 + (STAMP % 20_000) * 10;
let orgSeq = 0;
const ORGS: number[] = [];
let conn: mysql.Connection;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);

const ctx = (org: number, role: string, userId: number) => {
  tenant.org = org; tenant.role = role;
  return { ...makeContext({ ...mockUser, id: userId }), correlationId: `corr-esc-${org}-${userId}`, requestId: `req-esc-${org}` } as any;
};
const proc = (org: number, role = "operator", userId = 101) => procurementProcessRouter.createCaller(ctx(org, role, userId));
const ops = (org: number, role = "viewer", userId = 101) => departmentOperationRouter.createCaller(ctx(org, role, userId));

async function newOrg(label: string): Promise<number> {
  const org = BASE_ORG + orgSeq++;
  ORGS.push(org);
  await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [org, `Órgão Sintético ${label}`, `esc-${org}`]);
  return org;
}
async function newProcess(org: number, seq: number, object = "Aquisição sintética de material de expediente"): Promise<string> {
  const ws = createProcurementWorkspace({ organizationId: org, processNumber: `2026/${String(9000 + seq)}`, object, modality: "pregao", startOption: "iniciar_pesquisa", responsibleUser: 101, correlationId: `esc-${org}-${seq}` });
  await insertProcess(ws);
  return ws.id;
}
async function declareSession(org: number, processId: string, certame: Record<string, unknown>, tag: string): Promise<void> {
  const evidence = encodeGovernedPayload(GOVERNED_FIELDS_SCHEMA, { sections: { CERTAME_CONFIG: certame } }).evidence;
  await recordHumanDecision(ctxOf(org), {
    subjectType: "procurement.source_fields", decisionType: "source_fields_declared", outcome: "declarado", mode: "revision", subjectId: processId, evidence,
    act: { confirm: true, idempotencyKey: `esc-${org}-${tag}-${STAMP}`, decision: decision() }, expectedRevision: 0,
  });
}

describe.skipIf(!DB)("Escopo do Edital persistido + sessão no calendário (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (ORGS.length) {
      const q = ORGS.map(() => "?").join(",");
      for (const t of ["procurement_context_facts", "process_timeline", "institutional_decisions", "operational_events", "procurement_processes", "organizations"]) {
        await conn.query(`DELETE FROM ${t} WHERE ${t === "organizations" ? "id" : "organization_id"} IN (${q})`, ORGS).catch(() => {});
      }
    }
    await conn.end();
  });

  it("S1 — escopo registrado sobrevive ao recarregamento; idempotente; CAS; papel e tenant", async () => {
    const org = await newOrg("s1");
    const other = await newOrg("s1-outro");
    const pid = await newProcess(org, 1);

    const empty = await proc(org).editalScopeSelection({ processId: pid });
    expect(empty).toMatchObject({ scope: null, valueHash: null, conflict: false });

    // viewer não registra (RBAC); nada gravado
    await expect(proc(org, "viewer").recordEditalScope({ processId: pid, modality: "pregao", form: "eletronico", platform: "bll", expectedValueHash: null }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ? AND path = 'edital.scope'", [org])).toBe(0);

    const r1 = await proc(org).recordEditalScope({ processId: pid, modality: "pregao", form: "eletronico", platform: "bll", expectedValueHash: null });
    expect(r1.recorded).toBe(true);
    expect(r1.selection.scope).toEqual({ modality: "pregao", form: "eletronico", platform: "bll" });

    // "recarregar": nova leitura devolve o mesmo escopo
    const reloaded = await proc(org, "viewer").editalScopeSelection({ processId: pid });
    expect(reloaded.scope).toEqual({ modality: "pregao", form: "eletronico", platform: "bll" });
    expect(reloaded.actorUserId).toBe(101);

    // mesmo valor ⇒ idempotente (nada novo), mesmo com hash antigo
    const again = await proc(org).recordEditalScope({ processId: pid, modality: "pregao", form: "eletronico", platform: "bll", expectedValueHash: null });
    expect(again.recorded).toBe(false);
    expect(await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ? AND path = 'edital.scope'", [org])).toBe(1);

    // CAS: quem viu "nada registrado" não sobrescreve a escolha já registrada
    await expect(proc(org, "operator", 202).recordEditalScope({ processId: pid, modality: "concorrencia", form: "presencial", expectedValueHash: null }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const r2 = await proc(org, "operator", 202).recordEditalScope({ processId: pid, modality: "concorrencia", form: "presencial", platform: "bll", expectedValueHash: reloaded.valueHash });
    expect(r2.selection.scope).toEqual({ modality: "concorrencia", form: "presencial", platform: null });
    const facts = await rows("SELECT source_type, actor_user_id, basis_value_hash FROM procurement_context_facts WHERE organization_id = ? AND path = 'edital.scope' ORDER BY id", [org]);
    expect(facts.map((f: any) => [f.source_type, Number(f.actor_user_id)])).toEqual([["user", 101], ["user", 202]]);
    expect(facts[1].basis_value_hash).toBe(reloaded.valueHash);
    expect(await count("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ? AND summary LIKE 'Escopo do Edital escolhido%'", [org, pid])).toBe(2);

    // linha do tempo em linguagem humana
    expect((await rows("SELECT summary FROM process_timeline WHERE organization_id = ? AND process_id = ? AND summary LIKE 'Escopo do Edital%' ORDER BY event_order", [org, pid])).map((r: any) => r.summary))
      .toEqual(["Escopo do Edital escolhido antes da geração: Pregão, forma eletrônica, plataforma BLL.", "Escopo do Edital escolhido antes da geração: Concorrência, forma presencial."]);

    // CORRIDA: duas pessoas, mesmo valor visto, escolhas diferentes ⇒ exatamente uma grava; a outra recebe CONFLICT
    const pid2 = await newProcess(org, 9);
    const race = await Promise.allSettled([
      proc(org, "operator", 301).recordEditalScope({ processId: pid2, modality: "pregao", form: "presencial", expectedValueHash: null }),
      proc(org, "operator", 302).recordEditalScope({ processId: pid2, modality: "leilao", form: "presencial", expectedValueHash: null }),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((r) => r.status === "rejected").map((r: any) => r.reason?.code)).toEqual(["CONFLICT"]);
    expect(await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ? AND process_id = ? AND path = 'edital.scope'", [org, pid2])).toBe(1);

    // escopo incompleto é recusado pela rota
    await expect(proc(org).recordEditalScope({ processId: pid, modality: "pregao", form: "eletronico", expectedValueHash: r2.selection.valueHash }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });

    // outro órgão: processo não existe ali (leitura e escrita), nada gravado no órgão alheio
    await expect(proc(other).editalScopeSelection({ processId: pid })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(proc(other).recordEditalScope({ processId: pid, modality: "pregao", form: "presencial", expectedValueHash: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ?", [other])).toBe(0);
  }, 120_000);

  it("S2 — sem parâmetros persistidos, a fronteira do Edital usa o escopo registrado (modelo vinculado sem reescolher)", async () => {
    const org = BASE_ORG + orgSeq++;
    ORGS.push(org);
    const w = await seedWorld(conn, org, "s2", { flagOn: true });
    await publishBllModel(org, 1, (p) => `esc-${p}-${org}-${STAMP}`);
    const before = await proc(org, "viewer").editalTemplateResolution({ processId: w.processId });
    expect(before.status).not.toBe("BOUND"); // sem escopo, nenhum modelo é presumido
    await proc(org).recordEditalScope({ processId: w.processId, modality: "pregao", form: "eletronico", platform: "bll", expectedValueHash: null });
    // "recarregar" sem reenviar os parâmetros: a resolução usa o escopo registrado
    const after = await proc(org, "viewer").editalTemplateResolution({ processId: w.processId });
    expect(after.status).toBe("BOUND");
    // proposta explícita da tela continua prevalecendo campo a campo
    const proposed = await proc(org, "viewer").editalTemplateResolution({ processId: w.processId, form: "presencial" });
    expect(proposed.status).not.toBe("BOUND");
  }, 300_000);

  it("S3 — sessão declarada na Configuração do certame aparece no calendário e no painel, sem gravar", async () => {
    const org = await newOrg("s3");
    const other = await newOrg("s3-outro");
    const p1 = await newProcess(org, 31, "Serviço sintético de limpeza");
    const p2 = await newProcess(org, 32);
    const pInactive = await newProcess(org, 33);
    const pNoDate = await newProcess(org, 34);
    const pOther = await newProcess(other, 35);
    await declareSession(org, p1, { dataAbertura: "2099-03-10", horarioAbertura: "09:30" }, "p1");
    await declareSession(org, p2, { dataAbertura: "2099-03-12" }, "p2");
    await declareSession(org, pInactive, { dataAbertura: "2099-03-11" }, "pi");
    await declareSession(org, pNoDate, { horarioAbertura: "10:00" }, "pn");
    await declareSession(other, pOther, { dataAbertura: "2099-03-10" }, "po");
    await conn.execute("UPDATE procurement_processes SET lifecycle_state = 'reset' WHERE organization_id = ? AND id = ?", [org, pInactive]);
    // evento cadastrado para p2 no mesmo dia ⇒ prevalece (sem duplicata)
    await conn.execute("INSERT INTO operational_events (id, organization_id, event_type, title, event_date, event_time, reference_type, reference_id) VALUES (?, ?, 'sessao_publica', 'Sessão cadastrada p2', '2099-03-12', '14:00', 'procurement_process', ?)",
      [`esc${String(org).slice(-9)}`, org, p2]);

    const writesBefore = await count("SELECT (SELECT COUNT(*) FROM operational_events WHERE organization_id = ?) + (SELECT COUNT(*) FROM institutional_decisions WHERE organization_id = ?) AS n", [org, org]);
    const cal = await ops(org).calendar({ from: "2099-03-01", to: "2099-03-31" });
    const sessions = cal.events.filter((e: any) => e.eventType === "sessao_publica");
    expect(sessions.map((e: any) => [e.referenceId, e.eventDate, e.eventTime, e.declaredIn ?? "cadastrado"])).toEqual([
      [p1, "2099-03-10", "09:30", "certame_config"],
      [p2, "2099-03-12", "14:00", "cadastrado"],
    ]);
    expect(sessions[0].title).toContain("Serviço sintético de limpeza");
    expect(sessions[0].referenceType).toBe("procurement_process");

    const dash = await ops(org).dashboard({ today: "2099-03-01" });
    expect(dash.upcomingEvents.some((e: any) => e.id === `certame:${p1}`)).toBe(true);
    // fora da janela ⇒ ausente
    expect((await ops(org).calendar({ from: "2099-04-01", to: "2099-04-30" })).events.some((e: any) => e.id === `certame:${p1}`)).toBe(false);
    // outro órgão só vê o seu
    const otherCal = await ops(other).calendar({ from: "2099-03-01", to: "2099-03-31" });
    expect(otherCal.events.map((e: any) => e.referenceId)).toEqual([pOther]);

    expect(await count("SELECT (SELECT COUNT(*) FROM operational_events WHERE organization_id = ?) + (SELECT COUNT(*) FROM institutional_decisions WHERE organization_id = ?) AS n", [org, org])).toBe(writesBefore);

    // registro governado CORROMPIDO (ex.: número não finito no payload) não derruba calendário nem painel: só é ignorado
    const pBad = await newProcess(org, 36);
    await declareSession(org, pBad, { dataAbertura: "2099-03-15" }, "pb");
    await conn.execute("UPDATE institutional_decisions SET evidence = ? WHERE organization_id = ? AND subject_id = ?",
      [JSON.stringify(["schema:governed-fields/1", "payload:{\"sections\":{\"CERTAME_CONFIG\":{\"dataAbertura\":\"2099-03-15\",\"x\":1e999}}}", "hash:00"]), org, pBad]);
    const calBad = await ops(org).calendar({ from: "2099-03-01", to: "2099-03-31" });
    expect(calBad.events.some((e: any) => e.referenceId === pBad)).toBe(false);
    expect(calBad.events.some((e: any) => e.id === `certame:${p1}`)).toBe(true);
    await expect(ops(org).dashboard({ today: "2099-03-01" })).resolves.toBeTruthy();
  }, 120_000);
});
