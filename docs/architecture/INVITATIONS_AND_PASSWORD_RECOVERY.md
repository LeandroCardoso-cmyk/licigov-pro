# Arquitetura — Acesso Institucional (PR A.1)
### Convites, recuperação de senha, gestão de membros e onboarding de tenants

## Por que este modelo

O LiciGov Pro é **institucional por convite** — não há cadastro público
(`ALLOW_PUBLIC_REGISTRATION=false` por padrão, fail-closed). O único caminho de entrada de um
servidor no sistema é receber um convite de quem já tem acesso à organização (ou, para a
primeira organização, do admin de plataforma via onboarding). Isso reflete a natureza do produto:
uma "camada inteligente operacional do departamento de licitações" de um órgão público específico
— não uma plataforma de auto-cadastro.

## Componentes

```
domain/           invitations.ts, passwordPolicy.ts, authErrors.ts    — regras puras, sem I/O
services/
  security/        opaqueTokens.ts                                    — geração/hash de token
  email/            provider.ts, brevoProvider.ts, consoleProvider.ts,
                     fakeProvider.ts, templates.ts,
                     emailOutboxService.ts, emailDispatcher.ts        — outbox + envio
  invitationService.ts                                                — convites (I/O)
  passwordResetService.ts                                             — recuperação de senha (I/O)
  tenantOnboardingService.ts                                          — onboarding de tenant (I/O)
routers/
  invitationsRouter.ts, passwordResetRouter.ts,
  tenantOnboardingRouter.ts, organizationsRouter.ts (extensão)        — camada tRPC
client/src/pages/
  EsqueciSenha.tsx, RedefinirSenha.tsx, AceitarConvite.tsx            — público
  Usuarios.tsx, AdminOrganizacoes.tsx                                 — autenticado
```

## Modelo de dados (migration 0287 + `users.tokenVersion`/UNIQUE(email))

- **`institutional_invitations`**: um convite institucional. `activeKey` (`"{orgId}:{email}"`,
  UNIQUE nullable, só preenchido quando `status='pending'`) garante no banco que nunca existe
  mais de um convite pendente para o mesmo órgão+e-mail — substituir um convite é sempre
  "supersede do antigo (activeKey→NULL) + insert do novo", na mesma transação.
- **`password_reset_tokens`**: token de redefinição de senha, uso único (`consumedAt`), com
  revogação (`revokedAt`) de qualquer token anterior ao emitir um novo.
- **`email_outbox`**: outbox transacional — a mensagem é gravada na MESMA transação do comando
  que a origina (convite criado, reset solicitado); o envio em si é assíncrono via dispatcher.
- **`users.tokenVersion`**: contador de revogação de sessão (ver "Revogação de sessão" abaixo).
- **`users.email` UNIQUE**: o e-mail é a identidade institucional.

## Ciclo de vida do token de convite

```
generateOpaqueToken() → 256 bits, base64url          (nunca persistido em claro)
hashOpaqueToken(token) → SHA-256 hex                 (o que é salvo em tokenHash)
```

O token em texto claro só existe: (1) no momento da geração, (2) no corpo do e-mail enviado. Uma
vez enviado, é **irrecuperável** a partir do banco — por isso "reenviar convite" tecnicamente
gera um TOKEN NOVO (supersede do antigo), nunca reaproveita o token original.

Estados (`institutional_invitations.status`): `pending → accepted | cancelled | expired* | superseded`
(todos terminais, exceto `pending`). `expired` é também um estado **efetivo** — calculado por
tempo (`now >= expiresAt`) mesmo antes de qualquer escrita no banco marcar a linha como tal.
TTL: **7 dias** (constante de domínio, `domain/invitations.ts`).

## Ciclo de vida do token de redefinição de senha

Mesmo mecanismo de token opaco (gerar → hash → persistir só o hash). TTL: **1 hora** (mais curto
que o convite — a janela de exposição de uma conta comprometida via e-mail deve ser mínima).
`consumedAt` é marcado atomicamente, na mesma transação que troca a senha — protege contra replay
mesmo em corrida (duas abas, dois cliques no mesmo link).

## Revogação de sessão (`tokenVersion`)

O JWT de sessão carrega um claim `tv` (tokenVersion no momento da emissão). Redefinir a senha
incrementa `users.tokenVersion` atomicamente (`SET tokenVersion = tokenVersion + 1`, nunca
lê-depois-escreve). `sdk.authenticateRequest` compara `session.tv` com `user.tokenVersion` — se
divergirem, a sessão foi emitida antes da última troca de senha e é rejeitada (`Session revoked`).
Isso significa: **redefinir a senha derruba TODAS as sessões ativas**, incluindo a de um possível
invasor que tenha comprometido a conta. Sessões emitidas antes desta mudança (sem o claim `tv`)
são tratadas como `tv=0` — retrocompatíveis até a próxima redefinição de senha.

## Threat model (resumo)

| Ameaça | Mitigação |
|---|---|
| Enumeração de e-mail via "esqueci minha senha" | `passwordReset.request` sempre responde `{success:true}`, exista o e-mail ou não; nenhum log com nível "erro" para e-mail inexistente (só log estruturado interno). |
| Replay de link de convite/reset | Token de uso único (`consumedAt`/`status`); a transição de estado acontece na mesma transação que o efeito (senha trocada, conta criada). |
| Força bruta de token | 256 bits de entropia (espaço de busca inviável); rate limiting por identifier E, no reset, por hash do e-mail-alvo (`passwordReset`: 3/15min) — protege contra IPs rotativos inundando UM alvo específico. |
| Sequestro de conta sobrevivendo à troca de senha | `tokenVersion` — toda sessão anterior cai ao redefinir. |
| Vazamento de `passwordHash`/`signaturePassword` via API | `sanitizeUser`/`sanitizeUsers` (services/userProjection.ts) — único ponto por onde um `User` sai de um router; corrigido em `auth.me`, `admin.listUsers`, `organizations.listAllMembersWithUsers`. |
| Vazamento da API key do Brevo em logs de erro | `brevoProvider.ts` redige a chave de qualquer mensagem de erro antes de persistir/logar. |
| Escalonamento de privilégio via convite | `invitations.create` não aceita `role: "owner"` no input (só o onboarding de tenant cria owners); papel `owner` nunca pode ser alterado/removido via API de gestão de membros. |
| Organização ficar sem administração | Proteção "último admin" (`LAST_TENANT_ADMIN`) — rebaixar/desativar/remover o último `admin`/`owner` ativo é bloqueado; contagem sempre contra o banco real, nunca cacheada. |
| Vazamento cross-tenant | Toda operação de convite/membro é filtrada por `organizationId` explicitamente (nunca confia em um ID vindo só do payload); `invitations.resend`/`cancel` retornam `NOT_FOUND` idêntico para "não existe" e "existe mas é de outra organização". |
| E-mail nunca enviado silenciosamente | `config/email.ts` é fail-closed: fora de dev/teste, provider tem que ser Brevo e as credenciais têm que estar presentes — senão o boot lança, não a primeira tentativa de envio. |

## Códigos de erro estáveis

`server/domain/authErrors.ts` — 18 códigos, usados literalmente como `message` de `TRPCError`
(mesmo padrão de `NO_ORGANIZATION_MEMBERSHIP` em `tenantService.ts`). O client traduz via
`client/src/utils/authErrorMessages.ts` (duplicado de propósito — o client não importa `server/`).
Esses valores são um **contrato**: não renomear sem coordenar as duas pontas.

Grupos: convite (`INVITATION_*`), membros (`MEMBER_*`, `LAST_TENANT_ADMIN`,
`ROLE_ASSIGNMENT_FORBIDDEN`, `TENANT_ACCESS_FORBIDDEN`), redefinição de senha
(`PASSWORD_RESET_*`), rate limit (`RATE_LIMITED`), e-mail (`EMAIL_*`), onboarding
(`TENANT_ALREADY_EXISTS`, `ONBOARDING_CONFLICT`).

## Rollback lógico

Toda a mudança de schema é aditiva (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN`) — não há nada a
reverter estruturalmente para "desligar" a feature. Para desativar o fluxo institucional sem
reverter código:

1. `EMAIL_ENABLED=false` — para de enviar e-mails (convites/resets ficam presos em `pending` no
   outbox, sem side-effect visível ao usuário).
2. As rotas/routers continuam existindo mas ficam inertes sem e-mail saindo — não é necessário
   remover rotas do client nem do servidor para "desligar" o fluxo operacionalmente.
3. Não há dado destrutivo: convites/tokens não aceitos simplesmente expiram; nenhuma conta é
   criada sem aceite explícito do destinatário.

## Fora do escopo desta PR

Login social/SSO/SCIM/MFA/certificado digital; importação em massa de usuários; org-switcher
completo (existe hoje um seletor mínimo via `localStorage` para o admin de plataforma — ver
`main.tsx`/`AdminOrganizacoes.tsx` — não um seletor multi-organização para usuários comuns);
testes de frontend com testing-library/jsdom (a suíte atual testa lógica pura extraída para
módulos `.ts`, sem DOM — decisão registrada nesta sessão); refatoração do `emailService.ts`
legado (Resend); mudança do algoritmo de hash de senha (continua bcrypt, `SALT_ROUNDS=12`).
