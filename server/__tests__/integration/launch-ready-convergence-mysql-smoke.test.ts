/**
 * LICIGOV-LAUNCH-READY — CONVERGÊNCIA — smoke contra MySQL REAL e descartável (só roda com DATABASE_URL).
 * Organizações sintéticas (ids 99647x / slugs `lrc-*`); a organização 1 (dados reais) nunca é tocada.
 *
 * LR-01 onboarding recuperável · LR-02 proposta sem plano · LR-03 ativação por proposta desativada · LR-04 auditoria/validade da
 * licença · LR-05 pisos NEW-006 nos 13 atos · LR-06 organização desativada somente leitura · LR-08 aviso comercial via outbox.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { resetRateLimit } from "../../services/rateLimiter";
import { EMAIL_CONFIG } from "../../config/email";

const DB = process.env.DATABASE_URL;
const ORG_A = 996471; // ativa — papéis
const ORG_B = 996472; // outra organização (tenant cruzado)
const ORG_C = 996473; // DESATIVADA

describe.skipIf(!DB)("LAUNCH-READY convergência — MySQL real", { timeout: 60000 }, () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const users: Record<string, number> = {};
  const onboardedOrgIds: number[] = [];

  async function q<T = mysql.RowDataPacket[]>(sql: string, p: unknown[] = []): Promise<T> {
    const [rows] = await conn.execute(sql, p);
    return rows as T;
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    for (const [id, tag, ativo] of [[ORG_A, "a", 1], [ORG_B, "b", 1], [ORG_C, "c", 0]] as const) {
      await q(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, ?)`, [id, `Org sintética LRC ${tag} ${stamp}`, `lrc-fix-${tag}-${stamp}`, ativo]);
    }
    const insertUser = async (tag: string, role: "user" | "admin" = "user") => {
      const r = await q<mysql.ResultSetHeader>(`INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`,
        [`lrc-${tag}-${stamp}`, `Usuário ${tag}`, `lrc-${tag}-${stamp}@teste.local`, role]);
      users[tag] = r.insertId;
    };
    for (const role of ["viewer", "operator", "manager", "owner"]) {
      await insertUser(role);
      await q(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, users[role], role]);
    }
    await insertUser("managerB");
    await q(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'manager', 1)`, [ORG_B, users.managerB]);
    await insertUser("managerC");
    await q(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'manager', 1)`, [ORG_C, users.managerC]);
    await insertUser("nomember");
    await insertUser("platform", "admin");
  });

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    const orgs = [ORG_A, ORG_B, ORG_C, ...onboardedOrgIds];
    const ph = orgs.map(() => "?").join(",");
    await del(`DELETE FROM contracts WHERE organizationId IN (${ph})`, orgs);
    await del(`DELETE FROM tasks WHERE organizationId IN (${ph})`, orgs);
    await del(`DELETE FROM operational_settings WHERE organization_id IN (${ph})`, orgs);
    await del(`DELETE FROM licensed_modules WHERE organization_id IN (${ph})`, orgs);
    await del(`DELETE FROM email_outbox WHERE organizationId IN (${ph})`, orgs);
    await del(`DELETE FROM email_outbox WHERE idempotencyKey LIKE 'commercial_proposal:%' AND recipient = ?`, [`comercial-${stamp}@teste.local`]);
    await del(`DELETE FROM institutional_invitations WHERE organizationId IN (${ph})`, orgs);
    await del(`DELETE FROM activity_logs WHERE organizationId IN (${ph})`, orgs);
    await del(`DELETE FROM organization_members WHERE organizationId IN (${ph})`, orgs);
    await del(`DELETE FROM proposal_requests WHERE responsavelEmail LIKE ?`, [`lrc-%-${stamp}@teste.local`]);
    await del(`DELETE FROM audit_logs WHERE adminId = ?`, [users.platform]);
    const ids = Object.values(users);
    if (ids.length) await del(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    await del(`DELETE FROM organizations WHERE id IN (${ph})`, orgs);
    await conn.end();
  });

  async function caller(userId: number | null, role: "user" | "admin" = "user", headers: Record<string, string> = {}, ip = "127.0.0.1") {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: userId === null ? null : { id: userId, role, name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers, ip },
      res: {},
      correlationId: `test-lrc-${userId ?? "anon"}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }

  const contractInput = (over: Record<string, unknown> = {}) => ({
    number: `LRC-${Math.floor(Math.random() * 1e6)}`, year: 2026, object: "Objeto sintético", type: "servico" as const,
    contractorName: "Fornecedor Sintético", value: 1000, currentValue: 1000,
    startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2027-01-01T00:00:00Z"), ...over,
  });

  // ── LR-01 ────────────────────────────────────────────────────────────────────
  describe("LR-01 — onboarding consistente e recuperável", () => {
    const entry = (slug: string, email: string) => ({
      nome: `Órgão sintético ${slug}`, slug, esfera: "municipal" as const, firstAdminName: "Primeiro Admin",
      firstAdminEmail: email, actorUserId: users.platform, correlationId: `lrc-${slug}`,
    });
    const pendingOwner = async (orgId: number) => q(
      `SELECT id, emailNormalized, tokenHash FROM institutional_invitations WHERE organizationId = ? AND role = 'owner' AND status = 'pending'`, [orgId]);

    it("criação → retry devolve o MESMO convite pendente (sem duplicar órgão/convite)", async () => {
      const { onboardTenant } = await import("../../services/tenantOnboardingService");
      const slug = `lrc-new-${stamp}`;
      const first = await onboardTenant(entry(slug, `lrc-adm1-${stamp}@teste.local`));
      onboardedOrgIds.push(first.organizationId);
      expect(first.state).toBe("created");
      const again = await onboardTenant(entry(slug, `lrc-adm1-${stamp}@teste.local`));
      expect(again).toMatchObject({ state: "pending_invitation", invitationId: first.invitationId, organizationId: first.organizationId, alreadyExisted: true });
      expect((await q(`SELECT COUNT(*) n FROM organizations WHERE slug = ?`, [slug]))[0].n).toBe(1);
      expect(await pendingOwner(first.organizationId)).toHaveLength(1);
      expect((await q(`SELECT COUNT(*) n FROM institutional_invitations WHERE organizationId = ?`, [first.organizationId]))[0].n).toBe(1);
    });

    it("órgão ÓRFÃO (falha após o INSERT, sem convite nem evidência) → retry recupera com evidência e convite", async () => {
      const { onboardTenant } = await import("../../services/tenantOnboardingService");
      const { tenantOnboardingEvidenceHolds } = await import("../../services/invitationService");
      const slug = `lrc-orphan-${stamp}`;
      const r = await q<mysql.ResultSetHeader>(`INSERT INTO organizations (nome, slug, esfera, ativo) VALUES (?, ?, 'municipal', 1)`, [`Órgão sintético ${slug}`, slug]);
      onboardedOrgIds.push(r.insertId);
      const email = `lrc-adm2-${stamp}@teste.local`;
      const rec = await onboardTenant(entry(slug, email));
      expect(rec).toMatchObject({ state: "recovered", organizationId: r.insertId, alreadyExisted: true });
      expect(rec.invitationId).toBeGreaterThan(0);
      expect(await pendingOwner(r.insertId)).toHaveLength(1);
      expect(await tenantOnboardingEvidenceHolds({ organizationId: r.insertId, grantorUserId: users.platform, email })).toBe(true);
      expect((await q(`SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action = 'tenant.onboarding_recovered'`, [r.insertId]))[0].n).toBe(1);
      // E-mail do convite persistido no outbox (o envio é assíncrono e não decide a persistência).
      const inv = (await pendingOwner(r.insertId))[0];
      expect((await q(`SELECT COUNT(*) n FROM email_outbox WHERE idempotencyKey = ?`, [`invitation:${inv.tokenHash}`]))[0].n).toBe(1);
      // Novo retry: idempotente.
      const again = await onboardTenant(entry(slug, email));
      expect(again).toMatchObject({ state: "pending_invitation", invitationId: rec.invitationId });
    });

    it("convite 'morto' (sem evidência do bootstrap) → retry substitui por convite aceitável", async () => {
      const { onboardTenant } = await import("../../services/tenantOnboardingService");
      const { createInvitation } = await import("../../services/invitationService");
      const slug = `lrc-dead-${stamp}`;
      const r = await q<mysql.ResultSetHeader>(`INSERT INTO organizations (nome, slug, esfera, ativo) VALUES (?, ?, 'municipal', 1)`, [`Órgão sintético ${slug}`, slug]);
      onboardedOrgIds.push(r.insertId);
      const email = `lrc-adm3-${stamp}@teste.local`;
      const dead = await createInvitation({ organizationId: r.insertId, email, role: "owner", createdByUserId: users.platform, bootstrap: "tenant_onboarding" });
      const rec = await onboardTenant(entry(slug, email));
      expect(rec.state).toBe("recovered");
      expect(rec.invitationId).not.toBe(dead.id);
      const pend = await pendingOwner(r.insertId);
      expect(pend).toHaveLength(1);
      expect(pend[0].id).toBe(rec.invitationId);
    });

    it("falha DEFINITIVA do e-mail do convite → retry reemite (o convite anterior é supersedido)", async () => {
      const { onboardTenant } = await import("../../services/tenantOnboardingService");
      const slug = `lrc-mailfail-${stamp}`;
      const email = `lrc-adm4-${stamp}@teste.local`;
      const first = await onboardTenant(entry(slug, email));
      onboardedOrgIds.push(first.organizationId);
      const inv = (await pendingOwner(first.organizationId))[0];
      await q(`UPDATE email_outbox SET status = 'permanent_failure' WHERE idempotencyKey = ?`, [`invitation:${inv.tokenHash}`]);
      const rec = await onboardTenant(entry(slug, email));
      expect(rec.state).toBe("recovered");
      expect(rec.invitationId).not.toBe(first.invitationId);
      expect(await pendingOwner(first.organizationId)).toHaveLength(1);
    });

    it("órgão que já teve vínculo (mesmo inativo) NÃO recebe novo owner", async () => {
      const { onboardTenant } = await import("../../services/tenantOnboardingService");
      const slug = `lrc-members-${stamp}`;
      const r = await q<mysql.ResultSetHeader>(`INSERT INTO organizations (nome, slug, esfera, ativo) VALUES (?, ?, 'municipal', 1)`, [`Órgão sintético ${slug}`, slug]);
      onboardedOrgIds.push(r.insertId);
      await q(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 0)`, [r.insertId, users.nomember]);
      const res = await onboardTenant(entry(slug, `lrc-adm5-${stamp}@teste.local`));
      expect(res).toMatchObject({ state: "has_members", invitationId: 0 });
      expect((await q(`SELECT COUNT(*) n FROM institutional_invitations WHERE organizationId = ?`, [r.insertId]))[0].n).toBe(0);
    });

    it("retries CONCORRENTES sobre órgão órfão → no máximo 1 convite owner pendente, nenhum órgão duplicado", async () => {
      const { onboardTenant } = await import("../../services/tenantOnboardingService");
      const slug = `lrc-race-${stamp}`;
      const r = await q<mysql.ResultSetHeader>(`INSERT INTO organizations (nome, slug, esfera, ativo) VALUES (?, ?, 'municipal', 1)`, [`Órgão sintético ${slug}`, slug]);
      onboardedOrgIds.push(r.insertId);
      const email = `lrc-adm6-${stamp}@teste.local`;
      const results = await Promise.allSettled([onboardTenant(entry(slug, email)), onboardTenant(entry(slug, email))]);
      expect(results.some((x) => x.status === "fulfilled")).toBe(true);
      expect(await pendingOwner(r.insertId)).toHaveLength(1);
      expect((await q(`SELECT COUNT(*) n FROM organizations WHERE slug = ?`, [slug]))[0].n).toBe(1);
    });

    it("entrada DIFERENTE no mesmo slug → CONFLICT; usuário comum não chama o onboarding", async () => {
      const { onboardTenant } = await import("../../services/tenantOnboardingService");
      await expect(onboardTenant({ ...entry(`lrc-new-${stamp}`, `x-${stamp}@teste.local`), nome: "Outro nome" })).rejects.toMatchObject({ code: "CONFLICT" });
      const c = await caller(users.owner);
      await expect(c.tenantOnboarding.create({ nome: "Órgão X", slug: `lrc-x-${stamp}`, firstAdminName: "Adm", firstAdminEmail: `lrc-x-${stamp}@teste.local` }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── LR-02 / LR-08 ────────────────────────────────────────────────────────────
  describe("LR-02/LR-08 — proposta sem plano; aviso interno pelo outbox", () => {
    const input = (email: string, over: Record<string, unknown> = {}) => ({
      orgaoNome: "Órgão Sintético LRC", orgaoCnpj: "11222333000181", orgaoEndereco: "Rua Teste, 1", orgaoCidade: "Cidade Teste",
      orgaoEstado: "SP", orgaoCep: "01310100", responsavelNome: "Responsável Teste", responsavelEmail: email,
      responsavelTelefone: "11999998888", ...over,
    });

    it("banco sem nenhum plano requerido: solicitação persiste sem plano/preço; sem destinatário não há aviso e nada se perde", async () => {
      const ip = `10.8.1.${stamp % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const c = await caller(null, "user", {}, ip);
      const prev = EMAIL_CONFIG.commercialNotificationEmail;
      EMAIL_CONFIG.commercialNotificationEmail = "";
      try {
        const res = await c.commercial.create(input(`lrc-p1-${stamp}@teste.local`));
        const row = (await q(`SELECT planSlug, planName, planPrice, status FROM proposal_requests WHERE id = ?`, [res.proposalId]))[0];
        expect(row).toMatchObject({ planSlug: null, planName: null, planPrice: null, status: "pending" });
        expect((await q(`SELECT COUNT(*) n FROM email_outbox WHERE idempotencyKey = ?`, [`commercial_proposal:${res.proposalId}`]))[0].n).toBe(0);
      } finally { EMAIL_CONFIG.commercialNotificationEmail = prev; }
    });

    it("com destinatário configurado: 1 aviso por solicitação, conteúdo mínimo, reenvio não duplica", async () => {
      const ip = `10.8.2.${stamp % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const c = await caller(null, "user", {}, ip);
      const prev = EMAIL_CONFIG.commercialNotificationEmail;
      EMAIL_CONFIG.commercialNotificationEmail = `comercial-${stamp}@teste.local`;
      try {
        const email = `lrc-p2-${stamp}@teste.local`;
        const res = await c.commercial.create(input(email, { planSlug: "municipal-basico" }));
        await c.commercial.create(input(email, { observacoes: "reenvio" }));
        const rows = await q(`SELECT recipient, payload FROM email_outbox WHERE idempotencyKey = ?`, [`commercial_proposal:${res.proposalId}`]);
        expect(rows).toHaveLength(1);
        expect(rows[0].recipient).toBe(`comercial-${stamp}@teste.local`);
        const payload = JSON.stringify(rows[0].payload);
        expect(payload).toContain("Órgão Sintético LRC");
        expect(payload).not.toContain(email);
        expect(payload).not.toContain("11999998888");
        // Reenvio público não sobrescreve dados já registrados (só acrescenta observações).
        await c.commercial.create(input(email, { responsavelTelefone: "11000000000", responsavelNome: "Outro" }));
        const row = (await q(`SELECT planSlug, planPrice, observacoes, responsavelTelefone, responsavelNome FROM proposal_requests WHERE id = ?`, [res.proposalId]))[0];
        expect(row.planPrice).toBeNull();
        expect(row.observacoes).toBe("reenvio");
        expect(row).toMatchObject({ responsavelTelefone: "11999998888", responsavelNome: "Responsável Teste" });
      } finally { EMAIL_CONFIG.commercialNotificationEmail = prev; }
    });
  });

  // ── LR-03 ────────────────────────────────────────────────────────────────────
  describe("LR-03 — ativação por proposta desativada (proposal.id ≠ user.id)", () => {
    async function subsFor(userId: number) { return (await q(`SELECT COUNT(*) n FROM subscriptions WHERE userId = ?`, [userId]))[0].n; }

    it("IDs coincidentes e divergentes, replay: recusado sem criar assinatura", async () => {
      const ip = `10.8.3.${stamp % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const anon = await caller(null, "user", {}, ip);
      const { proposalId } = await anon.commercial.create({
        orgaoNome: "Órgão LR-03", orgaoCnpj: "11222333000181", orgaoEndereco: "Rua 1", orgaoCidade: "Cidade", orgaoEstado: "SP",
        orgaoCep: "01310100", responsavelNome: "Resp", responsavelEmail: `lrc-p3-${stamp}@teste.local`, responsavelTelefone: "11999998888",
      });
      await q(`UPDATE proposal_requests SET status = 'empenho_received', numeroEmpenho = 'NE-1' WHERE id = ?`, [proposalId]);
      const admin = await caller(users.platform, "admin");
      const before = await subsFor(proposalId);
      for (const userId of [proposalId, users.viewer, proposalId]) {
        await expect(admin.commercial.activateSubscription({ proposalId, userId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(await subsFor(proposalId)).toBe(before);
      expect(await subsFor(users.viewer)).toBe(0);
      expect((await q(`SELECT status FROM proposal_requests WHERE id = ?`, [proposalId]))[0].status).toBe("empenho_received");
    });

    it("papéis insuficientes / tenant: membro de órgão não acessa nenhuma operação comercial", async () => {
      const c = await caller(users.owner, "user", { "x-organization-id": String(ORG_B) });
      await expect(c.commercial.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.commercial.activateSubscription({ proposalId: 1, userId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.commercial.updateStatus({ proposalId: 1, status: "activated" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("checkout por usuário desativado (LR-07)", async () => {
      const c = await caller(users.viewer);
      await expect(c.billing.createCheckoutSession({ planSlug: "x", successUrl: "http://x", cancelUrl: "http://x" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── LR-04 ────────────────────────────────────────────────────────────────────
  describe("LR-04 — licença: auditoria da mutação e validade", () => {
    it("validade no passado → BAD_REQUEST, nada escrito; ativação válida grava auditoria da MUTAÇÃO", async () => {
      const admin = await caller(users.platform, "admin", { "x-organization-id": String(ORG_B) });
      await expect(admin.moduleLicensing.activateModule({ code: "contratos", expirationDate: "2020-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await q(`SELECT COUNT(*) n FROM licensed_modules WHERE organization_id = ?`, [ORG_B]))[0].n).toBe(0);
      await admin.moduleLicensing.activateModule({ code: "contratos", plan: "basic", expirationDate: "2099-12-31" });
      const audit = await q(`SELECT details FROM audit_logs WHERE adminId = ? AND details LIKE '%module_license_activate%' AND details LIKE ?`, [users.platform, `%"organizationId":${ORG_B}%`]);
      expect(audit.length).toBeGreaterThanOrEqual(1);
      const v = await (await caller(users.managerB)).moduleLicensing.validateLicense({ code: "contratos" });
      expect(v.active).toBe(true);
    });
  });

  // ── LR-05 ────────────────────────────────────────────────────────────────────
  describe("LR-05 — pisos da matriz NEW-006 nos 13 atos", () => {
    it("contracts.create: viewer ✗; operator rascunho ✓; operator 'active' ✗; manager 'active' ✓; sem membership ✗", async () => {
      await expect((await caller(users.viewer)).contracts.create(contractInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
      const draft = await (await caller(users.operator)).contracts.create(contractInput());
      expect(draft).toBeTruthy();
      await expect((await caller(users.operator)).contracts.create(contractInput({ status: "active" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect((await caller(users.manager)).contracts.create(contractInput({ status: "active" }))).resolves.toBeTruthy();
      await expect((await caller(users.nomember)).contracts.create(contractInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("aditivo/apostilamento/rescisão exigem manager (operator ✗ antes de qualquer escrita)", async () => {
      const op = await caller(users.operator);
      await expect(op.contracts.amendments.create({ contractId: 1, type: "prazo" } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(op.contracts.generation.generateRescission({ contractId: 1, type: "bilateral", reason: "x", effectiveDate: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("workspace.approveDecision exige manager; operationRecord.registerMilestone recusa viewer", async () => {
      await expect((await caller(users.operator)).workspace.approveDecision({ workspaceId: "ws-x", decisionId: "d-x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect((await caller(users.manager)).workspace.approveDecision({ workspaceId: "ws-x", decisionId: "d-x" })).rejects.not.toMatchObject({ code: "FORBIDDEN" });
      await expect((await caller(users.viewer)).operationRecord.registerMilestone({ referenceType: "processo", referenceId: "p-x", milestoneType: "certame" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("operator não altera contrato fora de rascunho (nem rebaixa status); altera rascunho", async () => {
      const active = await (await caller(users.manager)).contracts.create(contractInput({ status: "active" })) as { id: number };
      const op = await caller(users.operator);
      await expect(op.contracts.update({ id: active.id, value: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(op.contracts.update({ id: active.id, status: "draft" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await q(`SELECT status, value FROM contracts WHERE id = ?`, [active.id]))[0]).toMatchObject({ status: "active" });
      const draft = await op.contracts.create(contractInput()) as { id: number };
      await expect(op.contracts.update({ id: draft.id, notes: "ajuste" })).resolves.toBeTruthy();
      await expect((await caller(users.manager)).contracts.update({ id: active.id, notes: "ok" })).resolves.toBeTruthy();
    });

    it("tenant cruzado: manager do órgão B não altera contrato do órgão A", async () => {
      const created = await (await caller(users.manager)).contracts.create(contractInput()) as { id?: number; contractId?: number };
      const id = created.id ?? created.contractId;
      expect(id).toBeTruthy();
      await expect((await caller(users.managerB)).contracts.update({ id: id!, notes: "x" })).rejects.toBeTruthy();
      const row = (await q(`SELECT organizationId, notes FROM contracts WHERE id = ?`, [id]))[0];
      expect(row.organizationId).toBe(ORG_A);
      expect(row.notes ?? null).not.toBe("x");
    });
  });

  // ── DELTA-01 ─────────────────────────────────────────────────────────────────
  describe("DELTA-01 — mutações de negócio restantes seguem NEW-006", () => {
    it("viewer recusado em tarefas, workspace, parâmetros, geração de minuta, contratação direta, registros operacionais", async () => {
      const v = await caller(users.viewer);
      const calls: Array<() => Promise<unknown>> = [
        () => v.tasks.create({} as never),
        () => v.departmentTasks.create({} as never),
        () => v.workspace.createWorkspace({} as never),
        () => v.editalParameters.save({} as never),
        () => v.contracts.generation.generateMinuta({} as never),
        () => v.directContracts.create({} as never),
        () => v.operationRecord.createRecord({} as never),
        () => v.collaboration.addMember({} as never),
        () => v.platforms.publish({} as never),
      ];
      for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("operator elabora (tarefa criada); configuração institucional exige manager; exportação segue liberada ao viewer", async () => {
      const task = await (await caller(users.operator)).tasks.create({ title: "Tarefa sintética", type: "geral", priority: "media", assignedTo: users.operator });
      expect(task).toBeTruthy();
      await expect((await caller(users.operator)).operationRecord.updateSettings({ orgaoOficialName: "A", jornalName: "B", portalName: "C" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect((await caller(users.manager)).operationRecord.updateSettings({ orgaoOficialName: "A", jornalName: "B", portalName: "C" })).resolves.toBeTruthy();
      // Entrada válida (filtros opcionais): a exportação precisa CONCLUIR para o viewer, não só "não ser FORBIDDEN".
      await expect((await caller(users.viewer)).tasks.exportExcel(undefined)).resolves.toMatchObject({ data: expect.any(String) });
    });
  });

  // ── DELTA-02 ─────────────────────────────────────────────────────────────────
  describe("DELTA-02 — órgão desativado: exportação liberada, novo vínculo recusado", () => {
    it("exportação (export*) não é bloqueada; aceite de convite em órgão desativado é recusado sem criar vínculo", async () => {
      const m = await caller(users.managerC);
      await expect(m.tasks.exportExcel(undefined)).resolves.toMatchObject({ data: expect.any(String) });

      const { generateOpaqueToken, hashOpaqueToken } = await import("../../services/security/opaqueTokens");
      const { acceptExistingInvitation } = await import("../../services/invitationService");
      const token = generateOpaqueToken();
      const email = `lrc-nomember-${stamp}@teste.local`;
      await q(`INSERT INTO institutional_invitations (organizationId, emailNormalized, role, status, tokenHash, activeKey, expiresAt, createdByUserId)
        VALUES (?, ?, 'operator', 'pending', ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?)`, [ORG_C, email, hashOpaqueToken(token), `lrc-ak-${stamp}`, users.managerC]);
      await expect(acceptExistingInvitation({ token, userId: users.nomember, userEmail: email })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("ORGANIZATION_INACTIVE") });
      expect((await q(`SELECT COUNT(*) n FROM organization_members WHERE organizationId = ? AND userId = ?`, [ORG_C, users.nomember]))[0].n).toBe(0);
    });
  });

  // ── LR-06 ────────────────────────────────────────────────────────────────────
  describe("LR-06 — organização desativada é somente leitura", () => {
    it("membro: mutação recusada (ORGANIZATION_INACTIVE), leitura preservada; admin técnico auditado segue operando", async () => {
      const m = await caller(users.managerC);
      await expect(m.contracts.create(contractInput())).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("ORGANIZATION_INACTIVE") });
      await expect(m.contracts.list()).resolves.toBeTruthy();
      expect((await q(`SELECT COUNT(*) n FROM contracts WHERE organizationId = ?`, [ORG_C]))[0].n).toBe(0);
      const admin = await caller(users.platform, "admin", { "x-organization-id": String(ORG_C) });
      await expect(admin.moduleLicensing.activateModule({ code: "gestao_departamento" })).resolves.toBeTruthy();
      // Organização ATIVA: o mesmo papel opera normalmente (sem regressão).
      await expect((await caller(users.managerB)).contracts.create(contractInput())).resolves.toBeTruthy();
    });
  });
});
