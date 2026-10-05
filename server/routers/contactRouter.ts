import { z } from "zod";
import { throwLegacyEndpointDisabled } from "../services/legacyEndpointGuard";
import { publicProcedure, router } from "../_core/trpc";
import { rateLimitMiddleware } from "../services/rateLimiter";

/**
 * R2 / LEG-032 — formulário de contato público legado, DESATIVADO (decisão humana: DISABLE).
 *
 * `landing/ContactForm.tsx` não é alcançável por nenhuma página roteada; o canal comercial público canônico é
 * `/solicitar-proposta` → `commercial.create` (rate limit dedicado, honeypot, CNPJ validado, observabilidade).
 *
 * A procedure continua registrada e com o MESMO schema de input (contrato da API não some silenciosamente), mas o
 * handler recusa toda chamada com `FORBIDDEN` + `LEGACY_ENDPOINT_DISABLED` ANTES de qualquer efeito colateral
 * (nenhuma notificação ao dono — `notifyOwner` não é mais chamado daqui).
 *
 * Ordem de execução (tRPC 11 roda middlewares/validação na ordem de declaração):
 *  1. `rateLimitMiddleware("api")` — continua na frente (anti-abuso barato; só conta em memória por IP/usuário);
 *  2. validação zod do input (input inválido ⇒ `BAD_REQUEST`, sem efeito colateral);
 *  3. handler ⇒ `throwLegacyEndpointDisabled` (sempre `FORBIDDEN`).
 */
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
    .mutation(async ({ ctx }): Promise<{ success: boolean; message: string }> => {
      throwLegacyEndpointDisabled(
        "contact.submitContactForm",
        "LEG-032",
        ctx,
        "o formulário público /solicitar-proposta",
      );
    }),
});
