import { Redirect } from "wouter";

/**
 * LICIGOV-LAUNCH-READY LR-07 — a vitrine de planos com checkout por usuário ("Assinar agora"), teste grátis automático de 30 dias,
 * "SLA 98%" e preços vindos do seed foi retirada da jornada comercial ativa (decisão do Owner: licenciamento por organização,
 * por proposta e procedimento administrativo do órgão). O endpoint de checkout está desativado no servidor; o código e as
 * tabelas Stripe são preservados. Qualquer acesso a esta página leva à solicitação de proposta.
 */
export default function Plans() {
  return <Redirect to="/solicitar-proposta" replace />;
}
