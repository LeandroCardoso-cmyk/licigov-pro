import { notifyOwner } from "../_core/notification";

interface EmailNotification {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  message: string;
  processName?: string;
  documentType?: string;
}

/**
 * Envia notificação por email usando o sistema de notificações do Manus
 * Como não temos acesso direto ao email do destinatário via Manus,
 * vamos usar o sistema de notificações in-app como fallback
 */
export async function sendEmailNotification(notification: EmailNotification): Promise<boolean> {
  try {
    // Por enquanto, vamos apenas registrar a notificação
    // Em produção, você pode integrar com Resend, SendGrid, etc.
    console.log(`[Email] Enviando para ${notification.recipientEmail}:`, {
      subject: notification.subject,
      message: notification.message,
    });

    // Notificar o owner do sistema sobre a atividade
    await notifyOwner({
      title: `Notificação de Email: ${notification.subject}`,
      content: `Para: ${notification.recipientName} (${notification.recipientEmail})\n\n${notification.message}`,
    });

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
    message: `Olá ${params.recipientName},\n\n${params.inviterName} adicionou você ao processo licitatório "${params.processName}" como ${permissionLabels[params.permission]}.\n\nAcesse o processo: ${params.processUrl}\n\nAtenciosamente,\nEquipe LiciGov Pro`,
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
    message: `Olá ${params.recipientName},\n\n${params.editorName} editou o documento ${documentLabels[params.documentType]} no processo "${params.processName}".\n\nAcesse o processo: ${params.processUrl}\n\nAtenciosamente,\nEquipe LiciGov Pro`,
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
    message: `Olá ${params.recipientName},\n\n${params.commenterName} comentou no documento ${documentLabels[params.documentType]} do processo "${params.processName}":\n\n"${params.commentPreview}"\n\nAcesse o processo: ${params.processUrl}\n\nAtenciosamente,\nEquipe LiciGov Pro`,
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
    message: `Olá ${params.recipientName},\n\n${params.approverName} aprovou o documento ${documentLabels[params.documentType]} no processo "${params.processName}".\n\nAcesse o processo: ${params.processUrl}\n\nAtenciosamente,\nEquipe LiciGov Pro`,
    processName: params.processName,
    documentType: params.documentType,
  });
}
