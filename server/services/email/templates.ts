/**
 * PR A.1 — Templates de e-mail transacional (convite, convite reenviado, redefinição de senha,
 * senha alterada). Puro: recebe dados já resolvidos (URLs prontas, datas), não sabe nada sobre
 * banco/config — quem monta a URL (APP_BASE_URL + token) é o service que chama este módulo
 * (C7/C8). `escapeHtml` próprio, mesmo padrão de documentRenderService.ts:49-55.
 */

import type { OrgRole } from "../../../drizzle/schema";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formato fixo pt-BR/America-Sao_Paulo — determinístico independente do TZ do servidor. */
function formatDateTimePtBR(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(date) + " (horário de Brasília)";
}

const ORG_ROLE_LABELS_PT: Record<OrgRole, string> = {
  owner: "Proprietário(a)",
  admin: "Administrador(a)",
  manager: "Gerente",
  operator: "Operador(a)",
  viewer: "Visualizador(a)",
};

/** Layout HTML compartilhado — cabeçalho com a marca, corpo, rodapé de segurança. */
function renderLayout(opts: { preheader: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LiciGov Pro</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<span style="display:none;font-size:1px;color:#f4f5f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="background:linear-gradient(135deg,#0ea5e9 0%,#06b6d4 100%);padding:24px 32px;">
<span style="color:#ffffff;font-size:20px;font-weight:700;">LiciGov Pro</span><br>
<span style="color:rgba(255,255,255,0.85);font-size:13px;">Camada inteligente operacional do departamento de licitações</span>
</td></tr>
<tr><td style="padding:32px;">
${opts.bodyHtml}
</td></tr>
<tr><td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
<p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5;">
Esta é uma mensagem automática do LiciGov Pro. Se você não esperava este e-mail, pode ignorá-lo com segurança — nenhuma ação será tomada.
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `<div style="text-align:center;margin:28px 0;">
<a href="${escapeHtml(url)}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:6px;">${escapeHtml(label)}</a>
</div>
<p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;word-break:break-all;">Ou copie e cole este link no navegador:<br>${escapeHtml(url)}</p>`;
}

// ─── Convite institucional ────────────────────────────────────────────────────

export interface InvitationEmailParams {
  organizationName: string;
  inviterName: string;
  role: OrgRole;
  acceptUrl: string;
  expiresAt: Date;
  recipientName?: string;
}

function buildInvitationContent(params: InvitationEmailParams, resent: boolean): EmailContent {
  const roleLabel = ORG_ROLE_LABELS_PT[params.role];
  const greeting = params.recipientName ? `Olá, ${params.recipientName}!` : "Olá!";
  const expiresText = formatDateTimePtBR(params.expiresAt);
  const subjectPrefix = resent ? "[Reenvio] " : "";

  const bodyHtml = `
<h1 style="margin:0 0 16px 0;font-size:20px;color:#111827;">${escapeHtml(greeting)}</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
${escapeHtml(params.inviterName)} convidou você para fazer parte da organização
<strong>${escapeHtml(params.organizationName)}</strong> no LiciGov Pro, com o papel de
<strong>${escapeHtml(roleLabel)}</strong>.
</p>
${button(params.acceptUrl, "Aceitar convite e criar minha conta")}
<p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">
Este convite é válido até <strong>${escapeHtml(expiresText)}</strong>. Depois disso será necessário solicitar um novo convite.
</p>
<p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">
Se você não esperava este convite, ignore este e-mail — nenhuma conta será criada sem que o link acima seja aberto e o formulário concluído.
</p>`;

  const text = [
    greeting,
    "",
    `${params.inviterName} convidou você para fazer parte da organização ${params.organizationName} no LiciGov Pro, com o papel de ${roleLabel}.`,
    "",
    `Aceite o convite acessando: ${params.acceptUrl}`,
    "",
    `Este convite é válido até ${expiresText}. Depois disso será necessário solicitar um novo convite.`,
    "",
    "Se você não esperava este convite, ignore este e-mail — nenhuma conta será criada sem que o link acima seja aberto e o formulário concluído.",
  ].join("\n");

  return {
    subject: `${subjectPrefix}Convite para ${params.organizationName} — LiciGov Pro`,
    html: renderLayout({ preheader: `Você foi convidado para a organização ${params.organizationName}.`, bodyHtml }),
    text,
  };
}

export function buildInvitationEmail(params: InvitationEmailParams): EmailContent {
  return buildInvitationContent(params, false);
}

export function buildInvitationResentEmail(params: InvitationEmailParams): EmailContent {
  return buildInvitationContent(params, true);
}

// ─── Redefinição de senha ──────────────────────────────────────────────────────

export interface PasswordResetEmailParams {
  userName: string;
  resetUrl: string;
  expiresAt: Date;
}

export function buildPasswordResetEmail(params: PasswordResetEmailParams): EmailContent {
  const expiresText = formatDateTimePtBR(params.expiresAt);
  const bodyHtml = `
<h1 style="margin:0 0 16px 0;font-size:20px;color:#111827;">Redefinição de senha</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
Olá, ${escapeHtml(params.userName)}. Recebemos uma solicitação para redefinir a senha da sua conta no LiciGov Pro.
</p>
${button(params.resetUrl, "Redefinir minha senha")}
<p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">
Este link é válido até <strong>${escapeHtml(expiresText)}</strong> e só pode ser usado uma vez.
</p>
<p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">
Se você não solicitou esta redefinição, ignore este e-mail — sua senha permanece inalterada e nenhuma ação é necessária.
</p>`;

  const text = [
    `Olá, ${params.userName}. Recebemos uma solicitação para redefinir a senha da sua conta no LiciGov Pro.`,
    "",
    `Redefina sua senha acessando: ${params.resetUrl}`,
    "",
    `Este link é válido até ${expiresText} e só pode ser usado uma vez.`,
    "",
    "Se você não solicitou esta redefinição, ignore este e-mail — sua senha permanece inalterada e nenhuma ação é necessária.",
  ].join("\n");

  return {
    subject: "Redefinição de senha — LiciGov Pro",
    html: renderLayout({ preheader: "Redefina sua senha no LiciGov Pro.", bodyHtml }),
    text,
  };
}

// ─── Confirmação de senha alterada ─────────────────────────────────────────────

export interface PasswordChangedEmailParams {
  userName: string;
  changedAt: Date;
}

export function buildPasswordChangedEmail(params: PasswordChangedEmailParams): EmailContent {
  const changedText = formatDateTimePtBR(params.changedAt);
  const bodyHtml = `
<h1 style="margin:0 0 16px 0;font-size:20px;color:#111827;">Sua senha foi alterada</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
Olá, ${escapeHtml(params.userName)}. Confirmamos que a senha da sua conta no LiciGov Pro foi alterada em
<strong>${escapeHtml(changedText)}</strong>. Todas as sessões anteriores foram encerradas por segurança.
</p>
<p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">
Se foi você quem fez essa alteração, nenhuma ação é necessária. Se você <strong>não reconhece</strong> esta alteração,
entre em contato com o administrador da sua organização imediatamente.
</p>`;

  const text = [
    `Olá, ${params.userName}. Confirmamos que a senha da sua conta no LiciGov Pro foi alterada em ${changedText}.`,
    "Todas as sessões anteriores foram encerradas por segurança.",
    "",
    "Se foi você quem fez essa alteração, nenhuma ação é necessária.",
    "Se você não reconhece esta alteração, entre em contato com o administrador da sua organização imediatamente.",
  ].join("\n");

  return {
    subject: "Sua senha foi alterada — LiciGov Pro",
    html: renderLayout({ preheader: "Confirmação de alteração de senha.", bodyHtml }),
    text,
  };
}
