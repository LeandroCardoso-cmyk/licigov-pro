import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { notifyOwner } from "../_core/notification";

export const contactRouter = router({
  submitContactForm: publicProcedure
    .input(
      z.object({
        name: z.string().min(3, "Nome deve ter no mínimo 3 caracteres"),
        email: z.string().email("E-mail inválido"),
        organ: z.string().min(3, "Nome do órgão deve ter no mínimo 3 caracteres"),
        phone: z.string().min(10, "Telefone inválido"),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Enviar notificação para o proprietário
      const notificationSent = await notifyOwner({
        title: `Novo Contato: ${input.name}`,
        content: `
**Nome:** ${input.name}
**E-mail:** ${input.email}
**Órgão:** ${input.organ}
**Telefone:** ${input.phone}
${input.message ? `\n**Mensagem:**\n${input.message}` : ""}

Acesse o sistema para responder.
        `.trim(),
      });

      if (!notificationSent) {
        console.warn("[Contact] Failed to send notification to owner");
      }

      return {
        success: true,
        message: "Formulário enviado com sucesso! Entraremos em contato em breve.",
      };
    }),
});
