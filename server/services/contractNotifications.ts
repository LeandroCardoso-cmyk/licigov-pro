import { differenceInDays } from "date-fns";
import { getDb } from "../db";
import { contracts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

/**
 * Verifica contratos próximos ao vencimento e envia notificações
 * Alertas: 90, 60, 30 dias antes e no dia do vencimento
 */
export async function checkContractExpirations() {
  const db = await getDb();
  if (!db) {
    console.warn("[Contract Notifications] Database not available");
    return {
      success: false,
      message: "Database not available",
    };
  }

  try {
    // Buscar todos os contratos ativos
    const activeContracts = await db
      .select()
      .from(contracts)
      .where(eq(contracts.status, "active"));

    if (!activeContracts || activeContracts.length === 0) {
      return {
        success: true,
        message: "No active contracts to check",
        notificationsSent: 0,
      };
    }

    const today = new Date();
    let notificationsSent = 0;
    const notifications: Array<{
      contractId: number;
      contractNumber: string;
      daysUntilExpiry: number;
      alertType: string;
    }> = [];

    for (const contract of activeContracts) {
      const endDate = new Date(contract.endDate);
      const daysUntilExpiry = differenceInDays(endDate, today);

      // Verificar se precisa enviar notificação
      let shouldNotify = false;
      let alertType = "";

      if (daysUntilExpiry === 90) {
        shouldNotify = true;
        alertType = "90 dias";
      } else if (daysUntilExpiry === 60) {
        shouldNotify = true;
        alertType = "60 dias";
      } else if (daysUntilExpiry === 30) {
        shouldNotify = true;
        alertType = "30 dias";
      } else if (daysUntilExpiry === 0) {
        shouldNotify = true;
        alertType = "hoje";
      } else if (daysUntilExpiry < 0 && daysUntilExpiry >= -7) {
        // Contratos vencidos há até 7 dias
        shouldNotify = true;
        alertType = `vencido há ${Math.abs(daysUntilExpiry)} dias`;
      }

      if (shouldNotify) {
        // Enviar notificação
        const title = `⚠️ Alerta de Vencimento de Contrato`;
        const content = `
**Contrato:** ${contract.number}/${contract.year}
**Objeto:** ${contract.object}
**Contratado:** ${contract.contractorName}
**Valor Atual:** R$ ${contract.currentValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
**Data de Término:** ${endDate.toLocaleDateString("pt-BR")}
**Status:** ${alertType === "hoje" ? "Vence hoje!" : alertType === "vencido há " + Math.abs(daysUntilExpiry) + " dias" ? "Vencido!" : `Vence em ${alertType}`}

${daysUntilExpiry >= 0 ? "⏰ Providencie a renovação ou rescisão do contrato." : "🚨 Contrato vencido! Tome as providências necessárias."}
        `.trim();

        const notificationSent = await notifyOwner({
          title,
          content,
        });

        if (notificationSent) {
          notificationsSent++;
          notifications.push({
            contractId: contract.id,
            contractNumber: `${contract.number}/${contract.year}`,
            daysUntilExpiry,
            alertType,
          });
        }
      }
    }

    return {
      success: true,
      message: `Checked ${activeContracts.length} contracts, sent ${notificationsSent} notifications`,
      notificationsSent,
      notifications,
    };
  } catch (error) {
    console.error("[Contract Notifications] Error checking expirations:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      notificationsSent: 0,
    };
  }
}

/**
 * Gera resumo de contratos próximos ao vencimento
 */
export async function getExpirationSummary() {
  const db = await getDb();
  if (!db) {
    return null;
  }

  try {
    const activeContracts = await db
      .select()
      .from(contracts)
      .where(eq(contracts.status, "active"));

    const today = new Date();
    const summary = {
      expired: 0,
      expiring30: 0,
      expiring60: 0,
      expiring90: 0,
      total: activeContracts.length,
    };

    for (const contract of activeContracts) {
      const endDate = new Date(contract.endDate);
      const daysUntilExpiry = differenceInDays(endDate, today);

      if (daysUntilExpiry < 0) {
        summary.expired++;
      } else if (daysUntilExpiry <= 30) {
        summary.expiring30++;
      } else if (daysUntilExpiry <= 60) {
        summary.expiring60++;
      } else if (daysUntilExpiry <= 90) {
        summary.expiring90++;
      }
    }

    return summary;
  } catch (error) {
    console.error("[Contract Notifications] Error getting summary:", error);
    return null;
  }
}
