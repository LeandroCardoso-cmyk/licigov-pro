import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailNotification {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  message: string;
  processName?: string;
  documentType?: string;
}

/**
 * Envia notificação por email usando Resend
 */
export async function sendEmailNotification(notification: EmailNotification): Promise<boolean> {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn("[Email] RESEND_API_KEY não configurada, email não enviado");
      return false;
    }

    const { data, error } = await resend.emails.send({
      from: 'LiciGov Pro <onboarding@resend.dev>', // Em produção, use seu domínio verificado
      to: [notification.recipientEmail],
      subject: notification.subject,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
              }
              .header {
                background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%);
                color: white;
                padding: 30px;
                border-radius: 8px 8px 0 0;
                text-align: center;
              }
              .content {
                background: #f9fafb;
                padding: 30px;
                border-radius: 0 0 8px 8px;
              }
              .message {
                background: white;
                padding: 20px;
                border-radius: 6px;
                margin: 20px 0;
                white-space: pre-wrap;
              }
              .footer {
                text-align: center;
                margin-top: 30px;
                color: #6b7280;
                font-size: 14px;
              }
              .button {
                display: inline-block;
                background: #0ea5e9;
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 6px;
                margin: 20px 0;
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1 style="margin: 0;">LiciGov Pro</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">Automação de Processos Licitatórios</p>
            </div>
            <div class="content">
              <h2>Olá, ${notification.recipientName}!</h2>
              <div class="message">
                ${notification.message.replace(/\n/g, '<br>')}
              </div>
              ${notification.processName ? `
                <p><strong>Processo:</strong> ${notification.processName}</p>
              ` : ''}
              <div class="footer">
                <p>Esta é uma notificação automática do LiciGov Pro.</p>
                <p>Se você não esperava este email, pode ignorá-lo com segurança.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("[Email] Erro ao enviar:", error);
      return false;
    }

    console.log(`[Email] Enviado com sucesso para ${notification.recipientEmail}:`, data);
    return true;
  } catch (error) {
    console.error("[Email] Erro ao enviar notificação:", error);
    return false;
  }
}

/**
 * Template: Membro adicionado ao processo
 */
export async function sendMemberAddedEmail(params: {
  recipientEmail: string;
  recipientName: string;
  inviterName: string;
  processName: string;
  permission: string;
  processUrl: string;
}): Promise<boolean> {
  const permissionLabels: Record<string, string> = {
    viewer: "Visualizador",
    editor: "Editor",
    approver: "Aprovador",
    owner: "Proprietário",
  };

  return sendEmailNotification({
    recipientEmail: params.recipientEmail,
    recipientName: params.recipientName,
    subject: `Você foi adicionado ao processo "${params.processName}"`,
    message: `${params.inviterName} adicionou você ao processo licitatório "${params.processName}" como ${permissionLabels[params.permission]}.\n\nAcesse o processo: ${params.processUrl}\n\nAtenciosamente,\nEquipe LiciGov Pro`,
    processName: params.processName,
  });
}

/**
 * Template: Documento editado
 */
export async function sendDocumentEditedEmail(params: {
  recipientEmail: string;
  recipientName: string;
  editorName: string;
  processName: string;
  documentType: string;
  processUrl: string;
}): Promise<boolean> {
  const documentLabels: Record<string, string> = {
    etp: "ETP (Estudo Técnico Preliminar)",
    tr: "TR (Termo de Referência)",
    dfd: "DFD (Documento Formalizador de Demanda)",
    edital: "Edital",
  };

  return sendEmailNotification({
    recipientEmail: params.recipientEmail,
    recipientName: params.recipientName,
    subject: `Documento ${documentLabels[params.documentType]} foi editado`,
    message: `${params.editorName} editou o documento ${documentLabels[params.documentType]} no processo "${params.processName}".\n\nAcesse o processo: ${params.processUrl}\n\nAtenciosamente,\nEquipe LiciGov Pro`,
    processName: params.processName,
    documentType: params.documentType,
  });
}

/**
 * Template: Novo comentário adicionado
 */
export async function sendCommentAddedEmail(params: {
  recipientEmail: string;
  recipientName: string;
  commenterName: string;
  processName: string;
  documentType: string;
  commentPreview: string;
  processUrl: string;
}): Promise<boolean> {
  const documentLabels: Record<string, string> = {
    etp: "ETP",
    tr: "TR",
    dfd: "DFD",
    edital: "Edital",
  };

  return sendEmailNotification({
    recipientEmail: params.recipientEmail,
    recipientName: params.recipientName,
    subject: `Novo comentário no ${documentLabels[params.documentType]}`,
    message: `${params.commenterName} comentou no documento ${documentLabels[params.documentType]} do processo "${params.processName}":\n\n"${params.commentPreview}"\n\nAcesse o processo: ${params.processUrl}\n\nAtenciosamente,\nEquipe LiciGov Pro`,
    processName: params.processName,
    documentType: params.documentType,
  });
}

/**
 * Template: Documento aprovado
 */
export async function sendDocumentApprovedEmail(params: {
  recipientEmail: string;
  recipientName: string;
  approverName: string;
  processName: string;
  documentType: string;
  processUrl: string;
}): Promise<boolean> {
  const documentLabels: Record<string, string> = {
    etp: "ETP",
    tr: "TR",
    dfd: "DFD",
    edital: "Edital",
  };

  return sendEmailNotification({
    recipientEmail: params.recipientEmail,
    recipientName: params.recipientName,
    subject: `Documento ${documentLabels[params.documentType]} foi aprovado`,
    message: `${params.approverName} aprovou o documento ${documentLabels[params.documentType]} no processo "${params.processName}".\n\nAcesse o processo: ${params.processUrl}\n\nAtenciosamente,\nEquipe LiciGov Pro`,
    processName: params.processName,
    documentType: params.documentType,
  });
}
