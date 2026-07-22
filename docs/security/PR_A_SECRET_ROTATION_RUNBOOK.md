# Runbook de Rotação de Segredos — PR A (SEC-018)
### LiciGov Pro · Pré-piloto interno · Ação operacional humana

> **Estado:** `OPERATOR_ACTION_REQUIRED`.
> O arquivo `.env` estava rastreado no Git e foi removido do índice nesta PR
> (`git rm --cached .env`). O histórico do repositório **ainda contém** os valores
> commitados anteriormente — não há reescrita de histórico nesta PR (proibida).
> Portanto, **todo segredo que esteve versionado deve ser considerado comprometido
> e rotacionado operacionalmente.** Este runbook **não** contém nenhum valor de
> segredo e nenhum valor deve ser colado aqui, em logs, testes ou PRs.

## Variáveis a rotacionar

Confirmadas como versionadas no `.env` (nomes apenas):

| Variável | Sistema onde rotacionar | Impacto da rotação | Prioridade |
|---|---|---|---|
| `JWT_SECRET` | Railway (env do serviço) | Invalida todas as sessões ativas → todos os usuários precisam relogar | 1 (crítica) |
| `DATABASE_URL` | Provedor MySQL (Railway/externo) + Railway env | Troca de credencial do banco; exige janela de manutenção curta | 2 (crítica) |
| `GEMINI_API_KEY` | Google AI Studio + Railway env | Revoga a chave antiga; geração de IA usa a nova | 3 (alta) |

Verificar adicionalmente (rotacionar **se** estiveram versionados em algum momento):

| Variável | Sistema | Observação |
|---|---|---|
| `ADMIN_PASSWORD` | Railway env | Não estava no `.env` auditado, mas defina uma forte antes do go-live (agora obrigatória em produção — ver `CONFIG-005`). |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS IAM + Railway env | Rotacionar se as credenciais S3 já foram versionadas. |

## Ordem segura de execução

1. **Preparar** os novos valores nos cofres de origem (Google AI Studio, AWS IAM, provedor MySQL) **sem** aplicar ainda.
2. **Banco (`DATABASE_URL`)**: criar nova credencial, atualizar a env no Railway, reiniciar o serviço em janela de manutenção; validar conectividade (health/boot).
3. **`JWT_SECRET`**: gerar novo segredo (≥32 chars), atualizar env no Railway, reiniciar. Todas as sessões caem — comunicar os servidores antes.
4. **`GEMINI_API_KEY`**: emitir nova chave, atualizar env, reiniciar; revogar a chave antiga no console após confirmar a nova.
5. **`ADMIN_PASSWORD`**: definir/rotacionar; confirmar login administrativo com o novo valor.
6. **Credenciais AWS** (se aplicável): criar novo par IAM, atualizar env, validar upload/download S3, desativar o par antigo.

## Como validar sem exibir valores

- Conferir apenas **presença** via diagnóstico de ambiente (`environmentDiagnostic()` em `server/config/env.ts`), que retorna `present: boolean` — nunca o valor.
- Validar comportamento: login novo funciona (JWT), boot conecta (DB), geração de IA responde (Gemini), upload/download S3 ok (AWS).
- Confirmar que sessões antigas foram invalidadas (relogin exigido) após rotação do `JWT_SECRET`.

## Como invalidar o valor anterior

- **JWT_SECRET:** a simples troca invalida assinaturas antigas (tokens deixam de verificar).
- **GEMINI_API_KEY / AWS:** revogar/desativar explicitamente a credencial antiga no console do provedor após a nova estar ativa.
- **DATABASE_URL:** remover/expirar o usuário/credencial antigo no provedor MySQL.

## Rollback operacional

- Manter os valores antigos acessíveis apenas no cofre (nunca no repo) até a nova configuração ser validada em produção.
- Se a rotação de um segredo quebrar o serviço, restaurar temporariamente o valor anterior **no cofre/Railway** (não no Git), diagnosticar e repetir.
- Nenhum rollback envolve reescrever histórico do Git.

## Responsável e estado

- **Responsável humano:** operador de infraestrutura com acesso ao Railway, ao console Google AI e ao IAM AWS.
- **Estado do código nesta PR:** `CODE_COMPLETE` — `.env` fora do índice, `.env.example` sanitizado, `ADMIN_PASSWORD` obrigatória em produção, TTL de sessão reduzido.
- **Estado operacional:** `OPERATOR_ACTION_REQUIRED` — a rotação efetiva dos segredos e a sua verificação em produção dependem de ação humana no ambiente (`VERIFICATION_REQUIRED` após executar).

> Enquanto a rotação não for concluída e verificada, o achado `SEC-018` permanece
> **parcialmente resolvido** (código pronto; segredos ainda a rotacionar) e o item
> de gate correspondente (G5) permanece bloqueante.
