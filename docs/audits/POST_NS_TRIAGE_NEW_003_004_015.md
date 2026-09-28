# Triagem pós-turno — NEW-003 · NEW-004 · NEW-015 (+ NEW-016 · NEW-017)

> Achados **fora** do baseline 92/26/54/12. Triagem read-only com reprodução em MariaDB local; **nada corrigido** nesta execução.
> Os scripts de reprodução citados ficaram no scratchpad da sessão (não versionados).

- **Base auditada:** `origin/main` `5cd9d50` (worktree destacada, somente leitura; nada foi corrigido, commitado ou enviado).
- **Ambiente de reprodução:** MariaDB 10.11 local (`licigov_p4_triage`, `REPEATABLE-READ`), migrado com `pnpm db:migrate:release` (rc=0). Nenhum acesso a produção.
- **Scripts de reprodução** (fora do repo): `scratchpad/triage/new003_repro.ts`, `new004_repro.ts`, `newx_odoc_repro.ts`, `newx_odoc_owntx.ts`, `new015_repro.ts`. As saídas estão em `*_output.txt` e `*_full.log`.
- **Regra de impressão:** no NEW-003 foram impressos apenas **nomes de chaves** e booleanos (presença, prefixo bcrypt). Nenhum valor de hash foi impresso.

---

## NEW-003 — `lgpd.exportMyData` devolve a linha completa de `users` (hashes bcrypt e segredos internos)

### Evidência de código (ponta a ponta)

| Camada | Evidência | Observação |
|---|---|---|
| Montagem | `server/routers.ts:13,101` (`lgpd: lgpdRouter`) | API montada |
| Procedure | `server/routers/lgpdRouter.ts:35-38`: `exportMyData: protectedProcedure.mutation(... db.exportUserData(ctx.user.id))` | sem `.output()` e sem Zod de saída. Nenhuma projeção |
| Builder | `server/_core/trpc.ts:19-29` (`requireUser` só exige `ctx.user`) | **não** é `tenantProcedure`: não exige membership ativa, organização nem papel |
| Dados | `server/db/lgpd.ts:62-90`. `:66` `const user = await getUserById(userId)`. `:80` devolve `user` como está | — |
| Leitura | `server/db/users.ts:124-129`: `db.select().from(users)` (todas as colunas) | — |
| Serialização | `server/_core/trpc.ts:9-11` (`transformer: superjson`) | o superjson serializa todas as propriedades próprias enumeráveis; não filtra nada |
| Projeção existente (ignorada) | `server/services/userProjection.ts:1-42`: `sanitizeUser` é declarado "o ÚNICO ponto por onde um `User` deve passar antes de sair de um router" e omite `passwordHash`, `signaturePassword`, `tokenVersion`, `openId`, `loginMethod`, `updatedAt` | o `lgpdRouter` **não** usa essa projeção |
| Frontend | `grep trpc.lgpd` / `exportMyData` em `client/src`: **0 ocorrências** | sem UI e sem caller. Não há download ou gravação de arquivo no cliente |
| Testes | `grep lgpd\|exportUserData\|exportMyData` em `server/__tests__`: **0 testes** | `user-projection.test.ts` cobre só `sanitizeUser`, não os routers que a contornam |
| Auditoria | `exportUserData` não grava `activity_logs` nem `audit_logs` | a exportação de dados pessoais não deixa rastro |
| Inventário R2 | `docs/audits/R2_LEGACY_REACHABILITY_INVENTORY.md:134` (LEG-033: `lgpd` — `deleteMyAccount, exportMyData, …` — API_MOUNTED, NO_CALLER, **DISABLE decidido**) | a ficha NEW-002 (master plan §9.2) cita apenas `deleteMyAccount` |

### Reprodução (router real, `createCaller` e adapter HTTP fetch com superjson no fio)

Montagem do cenário:
- titular com `passwordHash` e `signaturePassword` bcrypt, e `tokenVersion=7`;
- membership **ativa** na Org A e **desativada** (`ativo=0`, servidor desligado) na Org B;
- um processo legado próprio em cada organização;
- na Org B, um documento criado por **outro** usuário.

Saída (`new003_output.txt`):

```
[createCaller] user keys: id, openId, name, email, loginMethod, role, theme, passwordHash, signaturePassword, tokenVersion, createdAt, updatedAt, lastSignedIn
  passwordHash: present=true nonNull=true bcryptPrefix=true
  signaturePassword: present=true nonNull=true bcryptPrefix=true
  tokenVersion: present=true nonNull=true
  openId: present=true nonNull=true
[createCaller] processes orgIds: [ 6, 7 ]   (orgA=6, orgB=7)
[createCaller] documents: {org:6, createdByOther:false}, {org:7, createdByOther:true, hasFileUrl:true}
[createCaller] document keys: … s3Key, fileUrl, … legalHold, retentionClass, purgeAfter, lockReason …
[wire] http status: 200
[wire] user keys: (as mesmas 13 chaves)
[wire] raw body contains bcrypt marker: passwordHash=true signaturePassword=true
```

**Confirmado.** `passwordHash`, `signaturePassword`, `tokenVersion` e `openId` chegam ao cliente no corpo HTTP.

### Classificação das colunas de `users` (`drizzle/schema.ts:7-26`)

| Coluna | Classe | No export? |
|---|---|---|
| `id` | identificador interno (não secreto) | sim (aceitável) |
| `openId` | **interno de segurança**: subject do JWT (`sdk.ts:104`) | **sim (vazamento)** |
| `name`, `email` | dado pessoal (portável) | sim (correto) |
| `loginMethod` | metadado de autenticação (baixo risco) | sim |
| `role` | autorização de plataforma (informativo) | sim |
| `theme` | preferência (portável) | sim |
| `passwordHash` | **SEGREDO**: hash bcrypt do login | **sim (vazamento)** |
| `signaturePassword` | **SEGREDO**: hash bcrypt da senha de assinatura (`legalOpinionsRouter.ts:342`, assinatura de parecer) | **sim (vazamento)** |
| `tokenVersion` | **interno de segurança**: contador de revogação de sessão (claim `tv`) | **sim (vazamento)** |
| `createdAt`, `lastSignedIn` | metadado pessoal (portável) | sim |
| `updatedAt` | metadado técnico | sim (inócuo) |

### Fronteira de tenant (achado adicional dentro de NEW-003)

- `lgpd.ts:67` seleciona `processes` só por `ownerId`, sem `organizationId`.
- `lgpd.ts:75` seleciona **todos** os `documents` desses processos, **inclusive os de outros autores**. Saem `content`, `structuredContent`, `s3Key`, `fileUrl` e metadados de retenção e `legalHold`.
- `comments`, `notifications` e `activity_logs` também saem sem filtro de organização.
- Como o builder é `protectedProcedure`, um servidor **desligado** (membership `ativo=0`), mas com conta e login válidos, continua exportando documentos institucionais da organização da qual saiu. Reproduzido: a Org B aparece com o documento de outro autor.
- `activity_logs.details` pode conter nomes de terceiros. Exemplo: "adicionou Fulano como editor" (`collaborationRouter.ts:186`).
- Mitigação parcial: a criação no pipeline legado `processes` está desativada (`LEGACY_PROCESS_PIPELINE_DISABLED`). A parte processos/documentos só afeta linhas legadas preexistentes. A presença dessas linhas em produção **não foi verificada**.
- A parte de segredos do usuário afeta **todos** os usuários.

### Alcance e impacto

- **Quem chama:** qualquer usuário autenticado, sobre si mesmo. Não há parâmetro de alvo, então um usuário não obtém os dados de outro diretamente.
- **Impacto real:**
  - um comprometimento transitório de sessão (cookie roubado, XSS, máquina compartilhada) vira **comprometimento durável de credencial**: com os hashes, o atacante faz cracking offline e continua entrando mesmo depois da revogação por `tokenVersion`;
  - o hash de `signaturePassword` permite cracking offline da senha de **assinatura de parecer jurídico** (risco de autoria e autoridade);
  - arquivos de "portabilidade" são salvos, encaminhados e anexados. Um segredo não pode estar em um artefato feito para circular.
- **Contradição com a regra do projeto:** "`sanitizeUser` é o ÚNICO ponto…" (`userProjection.ts:5`).

### Severidade proposta

**P1 SECURITY — SECRET EXPOSURE TO DATA SUBJECT**, fora do baseline, com duas agravantes:

- (a) quebra de fronteira de tenant para usuário desligado, restrita a dados legados;
- (b) exportação sem trilha de auditoria.

Não é P0 porque não há acesso cross-user direto e não há caller na UI. A API, porém, está montada e ao alcance de qualquer sessão.

### Tratamento proposto (não implementado)

1. **Curto prazo:** aplicar o DISABLE já decidido para LEG-033 **também** a `exportMyData`, deixando isso explícito na ficha NEW-002/NEW-003 (hoje o texto cita só `deleteMyAccount`).
2. **Projeção explícita por allowlist** para qualquer reativação, com Zod `.output()` estrito (`z.object({...}).strict()`):
   - **`user`:** `id`, `name`, `email`, `role`, `theme`, `loginMethod`, `createdAt`, `updatedAt`, `lastSignedIn`. Mais dois booleanos derivados, `hasPassword` e `hasSignaturePassword`, que informam ao titular que as credenciais existem sem entregar os hashes.
   - **Nunca sai:** `passwordHash`, `signaturePassword`, `tokenVersion`, `openId`.
   - **Consentimentos:** `consentType`, `version`, `accepted`, `createdAt`, `ipAddress`, `userAgent` (dados do próprio titular).
   - **Atividades:** `action`, `createdAt`, `ipAddress`, `entityType`, `entityId` e `organizationId`/`orgName`. Revisar `details` por conter dados de terceiros.
   - **Comentários e notificações:** o conteúdo **de autoria do titular**, com `organizationId` e sem dados de terceiros.
3. **Necessidade LGPD de portabilidade (art. 18, II e V):**
   - no contexto B2G, o **controlador** é o órgão público e o LiciGov é operador;
   - processos, documentos e anexos são **registros institucionais**, não dados pessoais "fornecidos pelo titular";
   - por isso **não** devem entrar no pacote de portabilidade; no máximo, uma lista de referências (id e título) das organizações em que o titular tem membership **ativa**;
   - nunca incluir `s3Key` ou `fileUrl`;
   - o atendimento ao titular deveria seguir o workflow governado de NEW-002: solicitação, análise pelo controlador e entrega auditada. Isso depende de revisão jurídica.
4. **Auditoria:** gravar `activity_logs` ou `audit_logs` "lgpd.export_requested" e "lgpd.export_delivered".
5. **Teste de regressão estrutural:** um smoke MySQL que chama cada procedure que devolve usuário e faz `expect(JSON.stringify(result)).not.toMatch(/passwordHash|signaturePassword|tokenVersion/)`, além de um teste do `.output()` estrito.

### Outros endpoints que poderiam devolver a linha completa de `users` (varredura)

| Superfície | Evidência | Estado |
|---|---|---|
| `auth.me` | `authRouter.ts:16` → `sanitizeUser(ctx.user)` | OK |
| `admin.listUsers` | `adminRouter.ts:12` → `sanitizeUsers(getAllUsers())` | OK |
| `organizations` membros com usuário | `db/organizations.ts:156` seleciona `user: users` completo → `organizationsRouter.ts:226` `sanitizeUser(r.user)` | OK. O shape cru chega ao router; a proteção depende de disciplina, então vale considerar projetar já no DB |
| `organizations.inviteMember` | `organizationsRouter.ts:95-127` usa `getUserByEmail` e devolve só `{ success, userId }` | OK |
| `collaboration.*` | `getActiveOrganizationUserById/ByEmail` usados só internamente (`id`, `name` em logs) | OK |
| Joins com `users` (`db/processes.ts:226,300`; `db/collaboration.ts:151,265`; `db/billing.ts:95,266`) | projeção explícita (`users.name`, `users.email`) | OK |
| `invitations.acceptInvitation` | o service devolve `openId` (`invitationService.ts:454`), mas o router devolve só `{ success, organizationId }` (`invitationsRouter.ts:113`) | OK |
| `legalOpinionWorkspaceService.buildSignatureSnapshot` | `getUserById` → usa só `name` (`:351-356`) | OK |

**Conclusão:** `lgpd.exportMyData` é a **única** exposição encontrada da linha completa de `users`. Não há candidato adicional.

---

## NEW-004 — ids e ordem de eventos derivados de contagem (`count`/`length`) seguida de upsert

### Padrão comum

```
order = (SELECT id … WHERE entidade).length        -- leitura NÃO bloqueante
id    = sha256(prefixo:org:entidade:order:eventType)  -- identidade derivada da ordem
INSERT … ON DUPLICATE KEY UPDATE summary = novo     -- colisão vira sobrescrita silenciosa
```

- Nenhuma dessas tabelas tem `UNIQUE(entidade, event_order)`. Todas têm só `PRIMARY KEY(id)` e índices não únicos (DDL real no banco migrado).
- Resultado com dois escritores concorrentes:
  - **mesmo `eventType`** → mesmo id → **um evento é perdido** e a linha que sobra é **híbrida**: `actor`, `refId` e `correlationId` do primeiro, `summary` do segundo;
  - **`eventType` diferente** → ids diferentes, mas **`event_order` duplicado**, e a ordenação (`ORDER BY event_order` sem desempate) fica indefinida.
  - Nenhum erro chega ao usuário. A perda é **indetectável**.
- **Transação não resolve.** Em `REPEATABLE READ`, o `SELECT` de contagem é uma leitura consistente sem lock; os dois veem N.

### Inventário (todos os pontos encontrados)

| # | Função / fluxo | Evidência | Tabela e chaves | Upsert | Transação/lock do chamador | Efeito concorrente |
|---|---|---|---|---|---|---|
| 1 | `recordProcessEvent`: **processo licitatório**, **contratação direta** (processId = ws.id), **contrato** (processId = ws.id) | `server/db/procurement.ts:394-420` (`:409` `order = existing.length`; `:412-414` id por order+eventType; `:415-419` upsert `summary`) | `process_timeline`: PK `id`; índices `idx_ptl_org_process` não únicos | `onDuplicateKeyUpdate({summary})` | Parte dos chamadores passa `tx` (`procurementItemsService.ts:420,472,532`; `procurementProcessService.ts:293…1050`), **sem lock**. `directProcurementRouter.ts:69-261`, `contractService.ts:75-309`, `itemIntelligenceRouter.ts:82` sem tx | perda e linha híbrida (mesmo tipo); order duplicado (tipos distintos). **Reproduzido** |
| 1b | Evento singleton de criação | `procurement.ts:104-108` (`idempotencyKey:"initial"`) | idem | id derivado da chave (DATA-039) | tx | seguro para retry; ainda consome a posição `order` por contagem |
| 2 | Histórico do **parecer** (`recordHistory`) | `server/services/legalOpinionWorkspaceService.ts:46-52`; `server/db/legalOpinionWorkspace.ts:201-220` (id `loh:org:ws:order:eventType`) | `legal_opinion_history`: PK `id`; `idx_loh_ws_order` **não único** | `summary` | nenhum | perda e linha híbrida (ex.: dois `draft_updated`). **Reproduzido** |
| 2b | Versão do **rascunho do parecer** (read-modify-write) | `legalOpinionWorkspaceService.ts:261-273`; `db/legalOpinionWorkspace.ts:173-177` (id `lov:org:draftId:version`) | `legal_opinion_versions` PK `id` | `contentHash`, `snapshot` | nenhum | lost update: duas edições geram a mesma `version` N+1 e o snapshot de uma se perde (análise estática) |
| 3 | **Aditivo contratual**: `sequence = count+1` | `server/services/contractService.ts:241`; `server/domain/contractInstruments.ts:58` (id `add:org:contract:sequence`); `server/db/contractWorkspace.ts:152-158,174-184` | `contract_addenda`: PK `id` | `status`, `justification`, `documentReference`, `legalOpinionRequestId`, `updatedAt` (**não** `addendumType` nem `newValue`) | nenhum (e há geração pesada no meio) | **1 aditivo híbrido**: tipo e valor de um, justificativa de outro. **Reproduzido**. Já registrado como **DATA-039 follow-up** (`docs/ops/DATA_039_ADDENDUM_ATOMICITY_FOLLOWUP.md`, PLANNED) |
| 4 | **Apostilamento**: `sequence = count+1` | `contractService.ts:268`; `contractInstruments.ts:117`; `contractWorkspace.ts:197-214` | `contract_ws_apostilles`: PK `id` | `description`, `documentReference` | nenhum | apostilamento híbrido ou perdido (análise estática; mesmo mecanismo de 3). Coberto por DATA-039 follow-up |
| 5 | Timeline da **solicitação institucional** | `server/services/institutionalRequestService.ts:44-51`; `server/domain/requestTimeline.ts:47-49`; `db/institutionalRequests.ts:155-161,174-180` | `request_timelines`: PK `id` | `summary` | nenhum | mesmo padrão de 1 |
| 6 | **Timeline operacional** (por organização inteira) | `server/services/operationRecordService.ts:24-30`; `server/domain/operationalTimeline.ts:34-36` (id por order+action+referenceId); `db/departmentOperation.ts:96-111` | `operational_timeline`: PK `id`; `idx_optl_org_order` não único | `summary` | nenhum | contenção **máxima** (escopo = organização): order duplicado frequente; perda quando action e referenceId coincidem |
| 7 | **Workspace timeline** | `server/services/workspaceTimelineService.ts:20-32` (`existing.length`); `server/domain/workspaceTimeline.ts:50-52`; `db/workspace.ts:114-123` | `workspace_timeline`: PK `id` | `summary` | nenhum | mesmo padrão de 1 |
| 8 | **Timeline do documento oficial**: evento `documento_exportado` | `server/services/officialDocumentLifecycleService.ts:33-39,152,157`; `db/officialDocuments.ts:118-133` | `official_document_timeline`: PK `id` | `summary` | **fora** do GET_LOCK | exportações concorrentes: perda do evento; exportação × nova versão: order duplicado |
| 9 | **Versão do documento oficial** (`countVersions+1`) | `officialDocumentLifecycleService.ts:94-110` | `official_documents`: PK `id` (`odoc:tenant:lineage:version`) | `content`, `status`, `metadata`, `updatedAt` | GET_LOCK, **liberado antes do commit** | ver **NEW-016** abaixo (achado novo, reproduzido) |
| — | Pontos com `count` que **não** geram identidade | `getSignatureCountForOrganization` (`legalOpinionsRouter.ts:169,354`, só para decisão), `countContractAddendaByOrg` (KPI), `db/organizations.ts:177` (último admin), `cognitive*`, `collaboration.ts:333` | — | — | — | fora do escopo de NEW-004 |

### Reprodução (`new004_output` em `new004_full.log`)

```
[A]  recordProcessEvent x10 concorrentes (mesmo eventType) → linhas=2; summaries sobreviventes=["S4","S9"]
[A]  linhas HÍBRIDAS=1 [{"order":0,"actor":"user:7","ref":"ref-7","corr":"c-7","summary":"S4"}]
[A2] 2 escritores concorrentes → linhas=1 [{"event_order":0,"actor":"user:2","summary":"Evento do usuário 1"}]
[B]  3 escritores, eventTypes distintos → linhas=3, orders=[0,0,0]
[C]  2 transações concorrentes (executor tx) → linhas=1 [{"event_order":0,"actor":"tx2","summary":"TX1"}]
[D]  histórico do parecer, 2 concorrentes → linhas=1 [{"actor":"adv1","summary":"Parecer atualizado por adv2"}]
[E]  2 aditivos concorrentes → linhas=1 [{"sequence":1,"addendum_type":"valor","new_value":"250000.00",
      "justification":"Prorrogação por 12 meses","correlation_id":"c-valor"}]
```

- **A2** responde à pergunta pedida: dois `recordProcessEvent` concorrentes com summaries diferentes deixam **1 linha**. Um summary se perdeu e a linha restante atribui a `user:2` o texto de `user:1`.
- **C** prova que rodar dentro de `db.transaction` (executor) **não** protege.
- **E**: aditivo de **valor R$ 250.000** gravado com a justificativa de uma **prorrogação de prazo**. É um instrumento contratual inconsistente, sem erro.

### Impacto

- **Integridade de auditoria:** eventos perdidos silenciosamente, sem erro e sem log.
- **Rastreabilidade:** linhas híbridas atribuem a um ator (e a uma `correlationId`) ações que ele não fez. Isso é pior que a perda, porque produz **evidência falsa**.
- **Replay/ordem:** `event_order` duplicado com `ORDER BY` sem desempate deixa a ordem da timeline não determinística entre leituras. A "reprodutibilidade" alegada nos comentários ("determinística, replay-safe") não vale sob concorrência.
- **Instrumentos jurídicos:** numeração de aditivo e apostilamento colide e mistura dados (3 e 4).
- **Fluxos afetados:** processo licitatório, parecer, contrato (timeline, aditivo, apostilamento), contratação direta, solicitações institucionais, timeline operacional e workspace.

A probabilidade é realista: vários servidores trabalham no mesmo processo, há duplo clique ou retry do cliente, workers como `recoverStuckImportSessions` e passos de IA assíncronos.

### Severidade proposta

- **P1 operacional / integridade de trilha de auditoria** para 1, 2, 5, 6, 7 e 8.
- **3 e 4** (aditivo e apostilamento) seguem como **DATA-039 follow-up**, já registrado e PLANNED. NEW-004 o generaliza, e a reprodução E fornece o critério de aceite.
- **2b** é candidato P2 (lost update de versão do rascunho).

### Opções de tratamento (não implementadas)

1. **Identidade independente da ordem:** `id = UUID v7` (ou `randomUUID`) por evento. O `INSERT` passa a ser **puro**, sem `onDuplicateKeyUpdate`, e uma colisão vira erro, nunca sobrescrita. O upsert fica só para eventos singleton.
2. **Identidade determinística por chave de idempotência** (o padrão DATA-039 já existente em `procurement.ts:412-413`), obrigatória para eventos singleton ou com retry: `id = sha256(prefixo:org:entidade:eventType:idempotencyKey)`.
3. **Ordem monotônica alocada sob lock:**
   - (a) tabela de contador por entidade (`timeline_counters(entity_key PK, next_order)`) com `SELECT … FOR UPDATE` ou `UPDATE … SET next_order = LAST_INSERT_ID(next_order+1)` **na mesma transação** do insert;
   - (b) `event_seq BIGINT AUTO_INCREMENT` global como desempate e ordem canônica, com `event_order` derivado só para exibição;
   - (c) `UNIQUE(organization_id, entidade, event_order)` com retry em `ER_DUP_ENTRY`, como rede de segurança.
4. **Ordenação de leitura:** `ORDER BY event_order, created_at, id` (ou `event_seq`) como mitigação imediata do não determinismo, sem resolver a perda.
5. **Aditivo e apostilamento:** seguir o desenho DATA-039 (UNIQUE `(org, contract, sequence)` + reserva → geração → finalização).
6. **Teste:** smoke MySQL com `Promise.all` de N escritores exigindo N linhas, orders distintas e nenhuma linha híbrida.

---

## NEW-015 — rollout percentual com `Math.random` por resolução

### Confirmação (`server/services/featureFlagService.ts`)

| Aspecto | Evidência | Fato |
|---|---|---|
| Aleatoriedade | `:73` `enabled = tenantFlag.enabled && (pct >= 100 \|\| Math.random() * 100 < pct)` | sorteio **a cada resolução não cacheada**; sem hash; **sem stickiness** por tenant ou usuário |
| Cache do servidor | `:8-10` `const cache = new Map…`; `CACHE_TTL_MS = 60_000` | **por processo Node**, em memória. O resultado do sorteio fica congelado por até 60 s e depois é sorteado de novo |
| Invalidação | `:94-107` `invalidateFlagCache` só limpa o Map **local**; chamada em `featureFlagAdminService.ts:407` | em várias réplicas, as outras continuam com o valor antigo por até 60 s |
| Expiração | `:71` override válido se `!expiresAt \|\| expiresAt >= now`; `:78-84` expirado → **valor global** (ou `false`) | override `enabled=false` expirado com global `true` → **habilita** (reproduzido). A expiração pode ser aplicada até 60 s depois (cache) |
| Cache do cliente | `client/src/hooks/ingestion/useIngestionCapabilities.ts:11-15` (`staleTime: 5*60*1000`, `refetchOnWindowFocus:false`) sobre `ingestion.getCapabilities` (`server/routers/ingestionRouter.ts:326-330`) | a UI fixa o valor por **5 min**, enquanto o servidor sorteia de novo a cada 60 s |
| Visão administrativa | `featureFlagAdminService.ts:180`: `effectiveValue = enabled && percentage >= 100` (determinística) | com `pct < 100`, o painel mostra **false** enquanto o runtime pode estar true (reproduzido) |
| Escrita governada | `featureFlagAdminService.ts:351,356,359` grava sempre `percentage: 100` | `pct < 100` só existe por escrita direta no banco (seed, SQL manual); não há caminho de API |
| Réplicas | `railway.json` não declara `numReplicas` | **número de réplicas do Railway desconhecido** (não verificado; sem acesso a produção) |
| Consumidores do runtime | `ingestionUploadService.ts:36`, `ingestionRouter.ts:329`, `importQueueService.ts:508` (worker de recuperação), `directContractShadowService.ts:96` | — |

### Reprodução (`new015_output.txt`)

```
[pct=50] 40 resoluções (cache invalidado entre elas): true=18 false=22 seq=1110110100011111001010010100000101000010
[pct=50] dentro do TTL (mesmo processo): false false (estável por até 60s)
[admin view] effectiveValue=false origin=tenant override.percentage=50
[expirado enabled=0 + global=1] isFeatureEnabled=true
```

### Modos de falha concretos (com `percentage < 100`)

1. **UI × servidor divergem:**
   - `getCapabilities` sorteia `true` e a UI exibe a ingestão por 5 min;
   - um upload 30 s depois cai em outra réplica, ou numa nova janela de 60 s, sorteia `false` e é recusado (`ingestionUploadService.ts:36`);
   - o contrário também acontece: a UI oculta a função enquanto o backend aceitaria.
2. **Flapping entre requisições:** o mesmo tenant alterna ligado e desligado a cada janela de 60 s (sequência acima). Um fluxo de várias etapas (upload → revisão → reprocesso) pode ter etapas com decisões opostas.
3. **Divergência entre instâncias:** cada réplica sorteia de forma independente. Para uma mesma organização, a réplica A pode estar `true` e a B `false` ao mesmo tempo. O worker `recoverStuckImportSessions` pode pular (`skipped++`) sessões que a API aceitou.
4. **Painel administrativo mente:** mostra `effectiveValue=false` enquanto o runtime habilita cerca de 50% das vezes.
5. **Expiração inverte a intenção:** um override "desligar até X" expira e herda o global. Se o global for `true`, liga, possivelmente com até 60 s de atraso por réplica.

### Mitigação vigente e regra

- **Decisão do owner para R2.2** (informada pelo orquestrador): `FF_CANONICAL_INGESTION` com **`percentage = 100` e `expiresAt = NULL`**. Com isso, `:73` curto-circuita em `pct >= 100` e o comportamento é determinístico.
- Em `origin/main` o ledger ainda mostra `R2.2 – R2.7 | TODO` (`docs/audits/SEMANTIC_AUTHORITY_REMEDIATION_MASTER_PLAN.md:460`). Recomenda-se registrar essa decisão no ledger.
- **Regra:** *não usar rollout percentual (`percentage < 100`) em decisões institucionais até que o algoritmo seja determinístico e sticky.* O caminho governado já força 100; escrita direta no banco com `< 100` deve ser tratada como incidente.

### Severidade proposta

**P2 latente** (mitigado). Sobe para **P1** se alguma flag institucional for configurada com `percentage < 100`.

### Correção futura (apenas esboço)

```ts
// bucket determinístico e estável por (flag, organização) — igual em todas as réplicas e no painel
function bucket(flagName: string, organizationId: number): number {
  const h = createHash("sha256").update(`ff:${flagName}:${organizationId}`).digest();
  return h.readUInt32BE(0) % 100;            // 0..99
}
const enabled = tenantFlag.enabled && (pct >= 100 || bucket(flagName, organizationId) < pct);
```

- O **mesmo** helper vale para `isFeatureEnabled` e `resolveTenantFlagCore`, para que o painel mostre o valor real.
- Opcionalmente, um salt por flag, para que tenants diferentes entrem em flags diferentes.
- Invalidação entre réplicas: TTL curto, versão da flag lida do banco, ou pub/sub.
- Expiração: definir se "expirado" herda o global ou é fail-closed (`false`). Hoje herda.

---

## Achados NOVOS (fora de NEW-003/004/015)

### NEW-016 (candidato): sobrescrita silenciosa de versão **EMITIDA** de documento oficial. O GET_LOCK é liberado antes do commit

| Campo | Valor |
|---|---|
| Severidade candidata | **P1 integridade/autoridade documental**. Candidato a **P0** se a emissão concorrente com regeneração for observada em fluxo real |
| Superfície | `officialDocumentLifecycleService.createDocument` (`server/services/officialDocumentLifecycleService.ts:94-110`), chamado **com executor** por `documentPromotionService.promoteOfficialDocument` (`:147-175`, emissão "emitido") e por `procurementProcessService` `persist` (`:828`, `:1019`, regeneração) |
| Mecanismo | `persist` faz `GET_LOCK` (`:96`) → conta versões → `insertOfficialDocument` → `RELEASE_LOCK` no `finally` (`:105`) **antes** do commit da transação externa (`:109`). Outro escritor adquire o lock, conta **sem** ver a linha não commitada, calcula a **mesma versão**, portanto o **mesmo id** (`odoc:tenant:lineage:version`, `server/domain/officialDocument.ts:101-102`) → `onDuplicateKeyUpdate({content,status,metadata})` (`server/db/officialDocuments.ts:50`) **sobrescreve** a versão já existente |
| Agravantes | (1) o retorno de `GET_LOCK(…,10)` é ignorado: em timeout, segue **sem lock**. (2) Em `procurementProcessService` a transação externa já fez leituras antes do GET_LOCK (`applyDraftContentMutationTx`), então o snapshot `REPEATABLE READ` pode estar desatualizado mesmo com o lock (teórico, não reproduzido). (3) `promoteOfficialDocument` lê o rascunho **fora** da transação e sem `FOR UPDATE` (`:80`), então não se serializa com a regeneração, que trava o rascunho (`procurement.ts:535`). Emissão e regeneração usam a mesma linhagem (`origin = processId`, mesmo `documentType`) |
| Reprodução | `newx_odoc_repro.ts`: tx1 emite (`status:"emitido"`) dentro de uma transação externa que continua por 1,5 s; tx2 cria concorrentemente. Resultado: `tx1 version=1`, `tx2 version=1`, o **mesmo id**. Linha final: `status:"gerado"`, `author:"emissor1"`, `content:"CONTEUDO DA TX2"`. A timeline fica com 2 eventos `event_order=0` (`documento_emitido` e `documento_criado`) |
| Controle | caminho sem executor (transação própria): 20 rodadas × 8 escritores concorrentes, **0 colisões** (`newx_owntx_output.txt`). A janela entre release e commit é mínima ali; o risco real está no caminho **com executor** |
| Impacto | viola a imutabilidade da versão oficial emitida (append-only prometido em `:57-59`); rebaixa o status `emitido` para `gerado`; o conteúdo emitido é trocado; o ledger `official_promotions.contentHash` deixa de bater com o documento; a timeline fica com ordem duplicada. A PR-D/DATA-012 (`docs/audits/production-readiness/PR_D_PRODUCTION_RESILIENCE.md:15`) é dada como resolvida |
| Tratamento proposto | liberar o lock **depois** do commit (lock no nível do chamador, envolvendo a transação inteira) **ou** trocar GET_LOCK por `SELECT … FOR UPDATE` numa linha de contador por linhagem (liberado no commit). Verificar o retorno de `GET_LOCK` (≠1 → falhar). `INSERT` puro para versões novas (colisão = erro, nunca upsert de `content`/`status`). `UNIQUE(tenant_id, lineage_id, version)`. Smoke com transação externa concorrente |

### NEW-017 (candidato): kill-switches de Ops semeados sem consumidor e com semântica invertida

| Campo | Valor |
|---|---|
| Severidade candidata | **P2 operacional** (falsa sensação de controle de emergência) |
| Evidência | `feature_flags` semeia `FF_IA_GLOBAL_DISABLE`, `FF_UPLOAD_DISABLE`, `FF_OUTBOX_DISPATCHER_PAUSE`, `FF_AUTOSAVE_SERVER_DISABLE`, `FF_CATMAT_SYNC_DISABLE` (banco migrado). `grep` em `server` e `client/src`: **nenhum consumidor** além da checagem por nome em `featureFlagService.ts:52` e `featureFlagAdminService.ts:115`. `isGlobalFlagEnabled` (`:123`) **não tem chamadores** |
| Semântica | a precedência nº 1 documentada ("kill-switch → false sempre", `:30`) só se aplica quando a flag **consultada** tem `_DISABLE` no nome, e nesse caso devolve `false` justamente quando o kill-switch está **ligado**. Um eventual consumidor que perguntasse "o kill-switch está ativo?" receberia `false`. Nenhuma flag de funcionalidade consulta kill-switch |
| Menor | `invalidateFlagCache(flagName)` não limpa as chaves `global:${flagName}` (`:98-101` × `:124`) |
| Tratamento proposto | decidir: remover os seeds decorativos **ou** ligá-los de fato (IA em `server/_core/llm.ts`, upload e outbox), com leitura via `isGlobalFlagEnabled`, semântica correta, invalidação coerente e teste |

### Observação (não é achado novo): NEW-002 × NEW-003

O inventário LEG-033 já decide **DISABLE** para o router `lgpd` inteiro, mas a ficha NEW-002 descreve só `deleteMyAccount`. Recomenda-se que o PR de DISABLE cubra explicitamente `exportMyData`, e que qualquer reativação futura passe pela allowlist do NEW-003.
