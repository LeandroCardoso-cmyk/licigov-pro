import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { notifyOwner } from "../_core/notification";
import { rateLimitMiddleware } from "../services/rateLimiter";

export const contactRouter = router({
  submitContactForm: publicProcedure
    .use(rateLimitMiddleware("api"))
    .input(
      z.object({
        name: z.string().min(3, "Nome deve ter no mínimo 3 caracteres").max(120),
        email: z.string().email("E-mail inválido").max(254),
        organ: z.string().min(3, "Nome do órgão deve ter no mínimo 3 caracteres").max(200),
        phone: z.string().min(10, "Telefone inválido").max(20),
        message: z.string().max(2000).optional(),
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
