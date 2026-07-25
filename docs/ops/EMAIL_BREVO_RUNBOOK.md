# Runbook — E-mail Transacional via Brevo (PR A.1)
### LiciGov Pro · Convites institucionais e recuperação de senha

> Este runbook cobre a operação do provider de e-mail transacional (Brevo) usado pelos fluxos de
> **convite institucional** e **recuperação de senha**. Não contém nenhum segredo — apenas nomes
> de variáveis, passos operacionais e queries de diagnóstico.

## 1. Verificação de domínio no painel Brevo (pré-requisito)

Antes de `EMAIL_ENABLED=true` em qualquer ambiente:

1. Acessar o painel Brevo → **Senders & Domains**.
2. Adicionar e verificar o domínio de envio (registros SPF/DKIM/DMARC no DNS do domínio —
   `licigovpro.com.br` em produção, subdomínio correspondente em staging se aplicável).
3. Cadastrar o remetente (`BREVO_SENDER_EMAIL`) sob esse domínio verificado. Remetentes não
   verificados são recusados ou caem em quarentena/spam com alta probabilidade.
4. Confirmar o limite de envio do plano Brevo é compatível com o volume esperado (convites +
   recuperações de senha — baixo volume nesta fase).

## 2. Variáveis de ambiente por ambiente

Fail-closed: fora de desenvolvimento/teste, `config/email.ts` **lança no boot** se qualquer uma
destas faltar, ou se `EMAIL_PROVIDER` resolver para algo diferente de `brevo`.

| Variável | development | staging/production |
|---|---|---|
| `EMAIL_PROVIDER` | `console` (default) — nunca configurar `brevo` aqui | `brevo` — **obrigatório**, sem default |
| `EMAIL_ENABLED` | `false` (default) | `true` |
| `BREVO_API_KEY` | — | **obrigatória** (painel Brevo → API Keys) |
| `BREVO_SENDER_EMAIL` | — | **obrigatória** (mesmo domínio verificado no passo 1) |
| `BREVO_SENDER_NAME` | — | `LiciGov Pro` (ou nome institucional do ambiente) |
| `APP_BASE_URL` | `http://localhost:3000` (default) | **obrigatória** — URL pública do ambiente (os links de convite/redefinição são montados a partir dela) |
| `EMAIL_MAX_ATTEMPTS` | 5 (default) | 5 (default; ajustável) |
| `EMAIL_DISPATCH_INTERVAL_MS` | 30000 (default) | 30000 (default; ajustável) |

Definir todas no Railway (env do serviço), nunca em arquivo versionado. `EMAIL_PROVIDER`/
`EMAIL_ENABLED` "console"/"fake" são **rejeitados** em staging/production pelo boot — não é
possível contornar isso via configuração incorreta silenciosa.

## 3. Investigar falha de entrega

Toda mensagem enviada (com sucesso ou não) fica registrada em `email_outbox` — é a auditoria.

```sql
-- Últimas mensagens com falha (permanente ou aguardando retry)
SELECT id, messageType, recipient, status, attempts, maxAttempts,
       lastErrorCode, lastErrorMessage, nextAttemptAt, createdAt
FROM email_outbox
WHERE status IN ('retryable_failure', 'permanent_failure')
ORDER BY createdAt DESC
LIMIT 50;
```

Leitura de `lastErrorCode`:

- `brevo_http_4xx` (exceto 429): erro do lado do payload/remetente — geralmente `permanent_failure`.
  Verificar `lastErrorMessage` (a API key nunca aparece nela — já é redigida antes de persistir).
- `brevo_http_429` / `brevo_http_5xx` / `brevo_timeout` / `brevo_network_error`: transitório —
  o dispatcher já reagenda automaticamente com backoff exponencial (1s → 2s → 4s ... teto 60s).
- `template_render_error`: o payload salvo no outbox não bate com o `templateKey` — sempre
  `permanent_failure` na primeira tentativa (não é um problema de rede, retry não ajudaria).

Verificar se o **dispatcher está rodando**: procurar no log da aplicação por
`dispatcher_started` (emitido uma vez no boot, quando `EMAIL_ENABLED=true`). Se ausente, checar
`EMAIL_ENABLED` no ambiente.

## 4. Replay de `permanent_failure`

Não existe hoje um botão de replay na UI. Para reprocessar manualmente uma mensagem que falhou
permanentemente (ex.: após corrigir o domínio verificado no Brevo):

```sql
UPDATE email_outbox
SET status = 'pending', attempts = 0, nextAttemptAt = NULL, lastErrorCode = NULL, lastErrorMessage = NULL
WHERE id = <id da mensagem>;
```

O dispatcher pega a linha no próximo ciclo (até `EMAIL_DISPATCH_INTERVAL_MS`, 30s por padrão) —
não é necessário reiniciar o serviço. Confirmar que a causa raiz foi corrigida antes (domínio,
API key, formato do e-mail do destinatário) — reenviar sem corrigir só reproduz a mesma falha.

## 5. Query de duplicatas de e-mail (pré-migration / pré-deploy)

A coluna `users.email` ganhou um índice `UNIQUE` nesta PR (aplicado via `ensureSchema`, que
**verifica duplicatas antes de criar o índice** e apenas registra um aviso no log em vez de
derrubar o boot caso existam — mas o índice não é criado até o saneamento). Rodar esta query
**antes** do deploy em qualquer ambiente com dados reais:

```sql
SELECT email, COUNT(*) AS quantidade
FROM users
WHERE email IS NOT NULL
GROUP BY email
HAVING COUNT(*) > 1;
```

Se houver resultado: decidir caso a caso (mesclar contas, ou anexar sufixo a contas obsoletas
antes de tornar o e-mail único) — **antes** de contar com o convite/recuperação de senha
funcionando de forma confiável para esses e-mails (o sistema de convites depende de e-mail como
identidade institucional única).

## 6. Escopo do Resend legado

`server/services/emailService.ts` (Resend, sender sandbox) permanece **intocado** por esta PR —
é usado por notificações de processo/documento não relacionadas ao acesso institucional. Não
compartilha configuração, outbox nem dispatcher com o fluxo desta PR.
