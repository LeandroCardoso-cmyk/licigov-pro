/**
 * V1 — SNAPSHOT imutável de ASSINATURA na materialização do Parecer (MySQL real).
 *
 * Exercita o SERVIÇO REAL (Institutional Request Engine → Parecer Jurídico → assinatura
 * manual) e prova, na fronteira de persistência (`official_documents`):
 *
 *  - a versão `emitido` guarda no metadata um snapshot HUMANO da assinatura, capturado
 *    no momento da emissão: signed, signerUserId, signerName (users.name), signerRole
 *    (organization_members.role), signatureMethod (manual), signedAt;
 *  - o snapshot NÃO depende de lookup mutável posterior — reler o documento devolve os
 *    MESMOS dados históricos (mesmo se o usuário mudar depois);
 *  - o CONTEÚDO JURÍDICO assinado NÃO é alterado (nada de bloco de assinatura embutido
 *    no conteúdo persistido; a assinatura é METADADO/representação, aplicada no render);
 *  - isolamento multi-tenant do documento oficial.
 *
 * Só roda com DATABASE_URL (CI com MySQL efêmero); PULADO sem banco.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, ensureSchema } from "../../bootstrap";
import { requestInstitutionalReview } from "../../services/institutionalRequestService";
import {
  openWorkspaceFromRequest, createOpinionDraft, signOpinion,
} from "../../services/legalOpinionWorkspaceService";
import { getOfficialDocument } from "../../services/documentEngineService";

const DB = process.env.DATABASE_URL;
const ORG = 994401;
const ORG_OTHER = 994402;
const SIGNER = 8801;            // procurador (signatário)
const SIGNER_NAME = "Procurador Homologacao V1";
const SIGNER_ROLE = "manager"; // papel institucional no organization_members
const REQUESTER = 8802;

let conn: mysql.Connection;

async function seedUserAndMembership(id: number, name: string, org: number, role: string) {
  await conn.query(
    "INSERT INTO `users` (id, openId, name, email, loginMethod, role, tokenVersion, passwordHash, createdAt, updatedAt) " +
    "VALUES (?, ?, ?, ?, 'password', 'user', 0, '$2b$12$x', NOW(3), NOW(3)) " +
    "ON DUPLICATE KEY UPDATE name=VALUES(name)",
    [id, `openid-${id}`, name, `user${id}@homolog.test`],
  ).catch(() => {});
  await conn.query(
    "INSERT INTO `organization_members` (organizationId, userId, role, ativo, createdAt, updatedAt) " +
    "VALUES (?, ?, ?, 1, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE role=VALUES(role), ativo=1",
    [org, id, role],
  ).catch(() => {});
}

async function cleanup() {
  for (const org of [ORG, ORG_OTHER]) {
    for (const t of ["institutional_requests", "institutional_responses", "request_assignments",
      "request_timelines", "request_notifications", "document_references",
      "official_documents", "official_document_timeline",
      "legal_opinion_workspaces", "legal_opinion_drafts", "legal_opinion_versions", "legal_opinion_history"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id = ? OR organizationId = ?`, [org, org]).catch(() => {});
    }
  }
}

let seq = 0;
/** Executa o fluxo real até a assinatura e devolve o official emitido do parecer. */
async function signParecerAndGetOfficial(org: number) {
  const uniq = `sig${org}-${++seq}`;
  const { request } = await requestInstitutionalReview({
    organizationId: org, sourceDomain: "contratacao_direta", destinationDomain: "parecer_juridico",
    requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: `proc-${uniq}`, title: "Parecer p/ assinatura",
    priority: "alta", requestedBy: REQUESTER, correlationId: `corr-${uniq}`,
  });
  const ws = await openWorkspaceFromRequest({ requestId: request.id, organizationId: org, lawyerId: SIGNER, correlationId: `corr-${uniq}` });
  await createOpinionDraft({
    workspaceId: ws.id, organizationId: org, author: SIGNER, opinionType: "LEGAL_OPINION_INITIAL",
    report: "Relatório do parecer.", foundation: "Fundamentação legal.", conclusion: "Pela viabilidade.",
    conclusionType: "favoravel", correlationId: `corr-${uniq}`,
  });
  const signed = await signOpinion({
    workspaceId: ws.id, organizationId: org, signedBy: SIGNER, method: "manual",
    idempotencyKey: `sig-key-${uniq}-${ws.id}`.slice(0, 60), correlationId: `corr-${uniq}`,
  });
  expect(signed.draft.signed).toBe(true);
  // localizar o official emitido do parecer (origin = workspace).
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT id FROM official_documents WHERE origin = ? AND tenant_id = ? AND status = 'emitido' LIMIT 1",
    [ws.id, org],
  );
  expect(rows.length).toBe(1);
  const doc = await getOfficialDocument(String((rows[0] as any).id), org);
  return { doc, workspaceId: ws.id, requestId: request.id };
}

describe.skipIf(!DB)("V1 — snapshot de assinatura do Parecer (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await ensureSchema(conn);
    await cleanup();
    await seedUserAndMembership(SIGNER, SIGNER_NAME, ORG, SIGNER_ROLE);
    await seedUserAndMembership(REQUESTER, "Solicitante", ORG, "operator");
    await seedUserAndMembership(SIGNER, SIGNER_NAME, ORG_OTHER, SIGNER_ROLE);
    await seedUserAndMembership(REQUESTER, "Solicitante", ORG_OTHER, "operator");
  }, 300_000);

  afterAll(async () => {
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM `organization_members` WHERE userId IN (?, ?)", [SIGNER, REQUESTER]).catch(() => {});
    await conn.query("DELETE FROM `users` WHERE id IN (?, ?)", [SIGNER, REQUESTER]).catch(() => {});
    await conn?.end();
  });

  it("materialização emitida grava snapshot humano completo da assinatura", async () => {
    const { doc } = await signParecerAndGetOfficial(ORG);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe("emitido");
    const snap = (doc!.metadata as Record<string, unknown>).signatureSnapshot as Record<string, unknown> | undefined;
    expect(snap).toBeTruthy();
    expect(snap!.signed).toBe(true);
    expect(snap!.signerUserId).toBe(SIGNER);
    expect(snap!.signerName).toBe(SIGNER_NAME);      // snapshot de users.name
    expect(snap!.signerRole).toBe(SIGNER_ROLE);      // snapshot de organization_members.role
    expect(snap!.signatureMethod).toBe("manual");
    expect(typeof snap!.signedAt).toBe("string");
    expect(String(snap!.signedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO
  }, 120_000);

  it("conteúdo jurídico assinado NÃO é alterado (assinatura é metadado, não conteúdo)", async () => {
    const { doc } = await signParecerAndGetOfficial(ORG);
    // O conteúdo persistido é o texto jurídico; o bloco de assinatura só aparece no RENDER.
    expect(doc!.content).toContain("Fundamentação legal.");
    expect(doc!.content).not.toContain("Assinatura registrada no LiciGov Pro");
    expect(doc!.content).not.toContain("Assinado em:");
  }, 120_000);

  it("re-leitura preserva os MESMOS dados históricos do signatário (sem lookup mutável)", async () => {
    const { doc } = await signParecerAndGetOfficial(ORG);
    const id = doc!.id;
    // Muda o nome do usuário DEPOIS da emissão — o snapshot histórico NÃO deve mudar.
    await conn.query("UPDATE `users` SET name = ? WHERE id = ?", ["Nome Alterado Depois", SIGNER]);
    const reread = await getOfficialDocument(id, ORG);
    const snap = (reread!.metadata as Record<string, unknown>).signatureSnapshot as Record<string, unknown>;
    expect(snap.signerName).toBe(SIGNER_NAME); // congelado na emissão
    // restaura para não afetar outros testes
    await conn.query("UPDATE `users` SET name = ? WHERE id = ?", [SIGNER_NAME, SIGNER]);
  }, 120_000);

  it("isolamento multi-tenant: official do parecer de um tenant não é visível a outro", async () => {
    const { doc } = await signParecerAndGetOfficial(ORG_OTHER);
    expect(await getOfficialDocument(doc!.id, ORG_OTHER)).not.toBeNull();
    expect(await getOfficialDocument(doc!.id, ORG)).toBeNull();
  }, 120_000);
});
