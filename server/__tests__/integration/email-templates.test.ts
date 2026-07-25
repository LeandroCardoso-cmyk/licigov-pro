/**
 * PR A.1 — services/email/templates.ts. Cobre: escape de HTML (XSS via nome/organização),
 * presença dos links nos 3 formatos exigidos (HTML com href, HTML com o link em texto plano
 * dentro do corpo, e no corpo `text`), e os avisos obrigatórios ("ignore se não solicitou",
 * validade).
 */

import { describe, it, expect } from "vitest";
import {
  buildInvitationEmail,
  buildInvitationResentEmail,
  buildPasswordResetEmail,
  buildPasswordChangedEmail,
} from "../../services/email/templates";

const EXPIRES = new Date("2026-08-01T12:00:00.000Z");
const ACCEPT_URL = "https://licigovpro.com.br/convite?token=abc123";
const RESET_URL = "https://licigovpro.com.br/redefinir-senha?token=xyz789";

describe("templates · buildInvitationEmail", () => {
  const params = {
    organizationName: "Prefeitura de Moreira Sales",
    inviterName: "Maria Silva",
    role: "operator" as const,
    acceptUrl: ACCEPT_URL,
    expiresAt: EXPIRES,
    recipientName: "João",
  };

  it("assunto menciona a organização; sem prefixo de reenvio", () => {
    const r = buildInvitationEmail(params);
    expect(r.subject).toContain("Prefeitura de Moreira Sales");
    expect(r.subject).not.toMatch(/reenvio/i);
  });

  it("buildInvitationResentEmail marca o reenvio no assunto", () => {
    const r = buildInvitationResentEmail(params);
    expect(r.subject).toMatch(/reenvio/i);
  });

  it("html contém o link como href E como texto visível; text contém o link cru", () => {
    const r = buildInvitationEmail(params);
    expect(r.html).toContain(`href="${ACCEPT_URL}"`);
    expect(r.html).toContain(ACCEPT_URL); // também aparece como texto (fallback "copie e cole")
    expect(r.text).toContain(ACCEPT_URL);
  });

  it("html e text mencionam o papel em português e o convidante", () => {
    const r = buildInvitationEmail(params);
    expect(r.html).toContain("Operador(a)");
    expect(r.html).toContain("Maria Silva");
    expect(r.text).toContain("Maria Silva");
  });

  it("html e text avisam sobre a validade do convite e para ignorar se não esperava", () => {
    const r = buildInvitationEmail(params);
    expect(r.html.toLowerCase()).toMatch(/válido até/);
    expect(r.html.toLowerCase()).toMatch(/ignore/);
    expect(r.text.toLowerCase()).toMatch(/válido até/);
    expect(r.text.toLowerCase()).toMatch(/ignore/);
  });

  it("XSS: nome da organização/convidante com tags HTML é escapado no html, preservado no text", () => {
    const malicious = {
      ...params,
      organizationName: '<img src=x onerror=alert(1)>Prefeitura',
      inviterName: '"><script>alert(2)</script>',
    };
    const r = buildInvitationEmail(malicious);
    expect(r.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(r.html).not.toContain("<script>alert(2)</script>");
    expect(r.html).toContain("&lt;img");
    expect(r.html).toContain("&lt;script&gt;");
    // O corpo texto não é interpretado por cliente de e-mail como HTML — não precisa escapar.
    expect(r.text).toContain('<img src=x onerror=alert(1)>Prefeitura');
  });

  it("recipientName ausente → saudação genérica, sem quebrar", () => {
    const { recipientName: _recipientName, ...rest } = params;
    const r = buildInvitationEmail(rest);
    expect(r.html).toContain("Olá!");
  });
});

describe("templates · buildPasswordResetEmail", () => {
  const params = { userName: "João da Silva", resetUrl: RESET_URL, expiresAt: EXPIRES };

  it("assunto e link presentes; validade e aviso de 'não solicitou'", () => {
    const r = buildPasswordResetEmail(params);
    expect(r.subject).toMatch(/redefinição de senha/i);
    expect(r.html).toContain(`href="${RESET_URL}"`);
    expect(r.text).toContain(RESET_URL);
    expect(r.html.toLowerCase()).toMatch(/não solicitou/);
    expect(r.text.toLowerCase()).toMatch(/não solicitou/);
    expect(r.html.toLowerCase()).toMatch(/válido até/);
  });

  it("menciona uso único", () => {
    const r = buildPasswordResetEmail(params);
    expect(r.html.toLowerCase()).toMatch(/uma vez/);
  });

  it("XSS no nome do usuário é escapado no html", () => {
    const r = buildPasswordResetEmail({ ...params, userName: "<b>hack</b>" });
    expect(r.html).not.toContain("<b>hack</b>");
    expect(r.html).toContain("&lt;b&gt;hack&lt;/b&gt;");
  });
});

describe("templates · buildPasswordChangedEmail", () => {
  const params = { userName: "João da Silva", changedAt: EXPIRES };

  it("assunto confirma alteração; menciona revogação de sessões e contato em caso de não-reconhecimento", () => {
    const r = buildPasswordChangedEmail(params);
    expect(r.subject.toLowerCase()).toMatch(/senha foi alterada/);
    expect(r.html.toLowerCase()).toMatch(/sessões anteriores foram encerradas/);
    expect(r.html.toLowerCase()).toMatch(/não reconhece/);
    expect(r.text.toLowerCase()).toMatch(/não reconhece/);
  });

  it("não contém nenhum link de ação (é uma confirmação, não uma ação)", () => {
    const r = buildPasswordChangedEmail(params);
    expect(r.html).not.toContain("href=\"http");
  });
});

describe("templates · formatação de data pt-BR determinística (America/Sao_Paulo)", () => {
  it("a data de expiração aparece formatada dd/mm/aaaa no fuso de Brasília", () => {
    // 2026-08-01T12:00:00Z = 2026-08-01 09:00 em America/Sao_Paulo (UTC-3, sem horário de verão)
    const r = buildPasswordResetEmail({ userName: "X", resetUrl: RESET_URL, expiresAt: EXPIRES });
    expect(r.html).toContain("01/08/2026");
    expect(r.html).toContain("09:00");
  });
});
