/**
 * B1 (homologação V1) — Institutional Request Engine contra MySQL REAL sob modo ESTRITO.
 *
 * Prova a fronteira REAL de persistência do Engine de Solicitações Institucionais — o
 * fluxo canônico "Contratação Direta → Solicitar Parecer Jurídico" — exercitando o
 * SERVIÇO REAL (`institutionalRequestService`), nunca reimplementando o router. O bug B1
 * era a gravação de ISO cru ("…T…Z") em colunas `datetime(3)`, que sob STRICT_TRANS_TABLES
 * derruba a operação com "Incorrect datetime value" (HTTP 500). Cobre, no mínimo:
 *
 *   (1) criação originada de Contratação Direta (source_domain = contratacao_direta);
 *   (2) round-trip de createdAt/updatedAt (entra/sai ISO; persiste em formato MySQL);
 *   (3) atribuição (request_assignments);
 *   (4) timeline append-only (request_timelines);
 *   (5) resposta (institutional_responses);
 *   (6) signedAt quando há assinatura;
 *   (7) notificação e referência documental do fluxo real;
 *   (8) atualização de status (updateRequestStatus / archive);
 *   (9) isolamento multi-tenant (jamais cruza organizações);
 *  (10) NENHUM "Incorrect datetime value" — o fluxo inteiro completa sem lançar.
 *
 * Só roda com DATABASE_URL (CI com MySQL efêmero); PULADO sem banco. NUNCA relaxa o sql_mode.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, ensureSchema } from "../../bootstrap";
import {
  requestInstitutionalReview,
  receiveRequest,
  respondRequest,
  archiveRequest,
  listDocumentReferences,
} from "../../services/institutionalRequestService";
import {
  getRequest,
  listRequestTimeline,
  listNotifications,
  getResponseForRequest,
} from "../../db/institutionalRequests";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 993301;
const ORG_OTHER = 993302; // isolamento multi-tenant
const REQUESTER = 41;
const LAWYER = 77;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

let conn: mysql.Connection;

/** Formato REALMENTE persistido (TEXTO) de uma coluna datetime — prova a conversão na fronteira. */
async function rawDatetime(table: string, col: string, id: string, org: number): Promise<string | null> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT CAST(\`${col}\` AS CHAR) AS c FROM \`${table}\` WHERE id = ? AND organization_id = ? LIMIT 1`,
    [id, org],
  );
  return rows.length && (rows[0] as any).c != null ? String((rows[0] as any).c) : null;
}

async function cleanup() {
  for (const org of [ORG, ORG_OTHER]) {
    for (const t of ["institutional_requests", "institutional_responses", "request_assignments",
      "request_timelines", "request_notifications", "document_references"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id = ?`, [org]).catch(() => {});
    }
  }
}

/** Cria a solicitação canônica de parecer jurídico originada da Contratação Direta. */
async function solicitarParecer(org = ORG, correlationId = "corr-b1-parecer") {
  return requestInstitutionalReview({
    organizationId: org,
    sourceDomain: "contratacao_direta",
    destinationDomain: "parecer_juridico",
    requestType: "LEGAL_OPINION_INITIAL",
    referenceProcessId: "proc-b1-cd",
    title: "Parecer sobre dispensa de licitação",
    description: "Solicitação de parecer jurídico inicial para contratação direta.",
    priority: "alta",
    requestedBy: REQUESTER,
    documents: [{ documentId: "doc-cd-01", title: "Termo de Dispensa", version: 1, snapshotSource: "conteudo-do-termo" }],
    correlationId,
  });
}

describe.skipIf(!DB)("B1 — Institutional Request Engine (MySQL estrito, fluxo Contratação Direta → Parecer)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await ensureSchema(conn);
    // Modo estrito GLOBAL → o pool getDb() do serviço real herda; SESSION para verificações diretas.
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    await cleanup().catch(() => {});
    await conn?.end();
  });

  it("fluxo real ponta a ponta persiste sem 'Incorrect datetime value' e faz round-trip ISO", async () => {
    // (1) Criação a partir de Contratação Direta — NÃO deve lançar sob modo estrito (B1).
    const { request, context } = await solicitarParecer();
    expect(request.sourceDomain).toBe("contratacao_direta");
    expect(request.destinationDomain).toBe("parecer_juridico");
    expect(request.status).toBe("PENDING");

    // (2) Round-trip: o modelo de domínio permanece ISO na leitura…
    const persisted = await getRequest(request.id, ORG);
    expect(persisted).not.toBeNull();
    expect(persisted!.createdAt).toMatch(ISO_RE);
    expect(persisted!.updatedAt).toMatch(ISO_RE);
    // …e o banco guardou no formato MySQL ("AAAA-MM-DD HH:MM:SS[.mmm]"), nunca ISO cru com T/Z.
    const rawCreated = await rawDatetime("institutional_requests", "created_at", request.id, ORG);
    const rawUpdated = await rawDatetime("institutional_requests", "updated_at", request.id, ORG);
    expect(rawCreated).toBeTruthy();
    expect(rawCreated).not.toMatch(/[TZ]/);
    expect(rawCreated).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(rawUpdated).not.toMatch(/[TZ]/);

    // (3) Atribuição na fila do domínio de destino.
    const [assign] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id, queue, CAST(created_at AS CHAR) AS c FROM request_assignments WHERE request_id = ? AND organization_id = ?",
      [request.id, ORG],
    );
    expect(assign.length).toBe(1);
    expect((assign[0] as any).queue).toBe("parecer_juridico");
    expect(String((assign[0] as any).c)).not.toMatch(/[TZ]/);

    // (4) Timeline append-only: eventos created + forwarded, createdAt ISO na leitura.
    let timeline = await listRequestTimeline(request.id, ORG);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline.map(e => e.eventType)).toEqual(expect.arrayContaining(["created", "forwarded"]));
    for (const e of timeline) expect(e.createdAt).toMatch(ISO_RE);

    // (7a) Referência documental do fluxo real (por referência, nunca copiada).
    expect(context.documentReferenceIds.length).toBe(1);
    const refs = await listDocumentReferences(request.id, ORG);
    expect(refs.length).toBe(1);
    expect(refs[0].documentId).toBe("doc-cd-01");

    // (7b) Notificação de nova solicitação (recipient 0 = fila do sistema).
    const notif0 = await listNotifications(ORG, 0);
    expect(notif0.some(n => n.requestId === request.id)).toBe(true);
    for (const n of notif0) expect(n.createdAt).toMatch(ISO_RE);

    // Destino recebe e passa a trabalhar (RECEIVED → IN_PROGRESS) — updateRequestStatus sob modo estrito.
    const inProgress = await receiveRequest(request.id, ORG, LAWYER);
    expect(inProgress.status).toBe("IN_PROGRESS");

    // (5)(6) Resposta assinada: institutional_responses + signedAt persistido.
    const signedAt = new Date().toISOString();
    const { responseId } = await respondRequest({
      id: request.id, organizationId: ORG, responder: LAWYER,
      responseType: "parecer", responseStatus: "concluido",
      comments: "Parecer favorável com ressalvas.", sign: "manual", signedAt,
      correlationId: "corr-b1-resp",
    });
    const resp = await getResponseForRequest(request.id, ORG);
    expect(resp).not.toBeNull();
    expect(resp!.id).toBe(responseId);
    expect(resp!.signed).toBe(true);
    // signed_at é VARCHAR (não datetime) — persiste o ISO tal qual, prova de assinatura.
    const [respRow] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT signed_at, CAST(created_at AS CHAR) AS c FROM institutional_responses WHERE id = ? AND organization_id = ?",
      [responseId, ORG],
    );
    expect(respRow.length).toBe(1);
    expect((respRow[0] as any).signed_at).toBeTruthy();
    expect(String((respRow[0] as any).c)).not.toMatch(/[TZ]/); // created_at (datetime) normalizado

    // Timeline recebe responded (+ signed); ordem monotônica, createdAt ISO.
    timeline = await listRequestTimeline(request.id, ORG);
    expect(timeline.map(e => e.eventType)).toEqual(expect.arrayContaining(["responded", "signed", "returned"]));
    for (const e of timeline) expect(e.createdAt).toMatch(ISO_RE);

    // Solicitação devolvida à origem e notificação ao solicitante.
    const returned = await getRequest(request.id, ORG);
    expect(returned!.status).toBe("RETURNED");
    const notifRequester = await listNotifications(ORG, REQUESTER);
    expect(notifRequester.some(n => n.requestId === request.id)).toBe(true);

    // (8) Atualização de status: arquivamento.
    const archived = await archiveRequest(request.id, ORG, LAWYER);
    expect(archived.status).toBe("ARCHIVED");
    expect((await getRequest(request.id, ORG))!.status).toBe("ARCHIVED");
  }, 120_000);

  it("isolamento multi-tenant: solicitação de um tenant não é visível a outro", async () => {
    const { request } = await solicitarParecer(ORG_OTHER, "corr-b1-tenant");
    // Existe sob ORG_OTHER…
    expect(await getRequest(request.id, ORG_OTHER)).not.toBeNull();
    // …e é INVISÍVEL sob outro tenant (escopo por organization_id).
    expect(await getRequest(request.id, ORG)).toBeNull();
    expect((await listRequestTimeline(request.id, ORG)).length).toBe(0);
    expect((await listDocumentReferences(request.id, ORG)).length).toBe(0);
  }, 120_000);
});
