# Runbook — publicar e vincular a Revisão 2 do `EDITAL_PREGAO_ELETRONICO_BLL` (dados de publicação diferidos)

> **Status: PARA REVISÃO. Nada deste runbook foi executado em produção.** A Revisão 2 é um pacote **candidato** no código (`1.0.2-draft`, catálogo
> `edital-pregao-eletronico-bll/1.0.2-draft.c3`). Registrar, aprovar, publicar e vincular são **decisões humanas distintas**; esta página só descreve como.
> Em nenhum passo: ligar/desligar flag, tocar processo, gerar/emitir documento real, alterar a Revisão 1, executar migration.

## 0. Identificadores exatos (conferir no momento da execução; qualquer divergência ⇒ PARE)

| Item | Valor esperado | Como obter |
|---|---|---|
| Commit em produção | contém `73a3d65a2c43695cd22820cc7c07d198ddc4ad8c` (ou posterior) | Railway → deployment SUCCESS do serviço `licigov-pro` (production) |
| Organização | `organizationId = 1` | — |
| Flag | `FF_INSTITUTIONAL_TEMPLATES_V1` ligada para a org 1 (**não alterar**) | `snapshot` (abaixo) |
| Identidade do modelo | `IDENTITY_ID` (id `ti…`) — anotar | `snapshot` |
| Revisão 1 | `REV1_ID` (id `tr…`), `PUBLISHED`, hash semântico `e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d` | `snapshot` |
| Vínculo ativo | exatamente **1** para a identidade, fixando `REV1_ID`; anotar `BINDING_ID` e as 5 dimensões do escopo (modalidade, forma, plataforma, regime, critério) | `snapshot` |
| Candidata | versão lógica `1.0.2-draft`; hash semântico `33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd`; catálogo `…/1.0.2-draft.c3` | `plan` |
| Fonte jurídica | SHA-256 `6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904` (a mesma da Revisão 1) | `plan` |
| Revisão candidata já registrada? | **não** (nenhuma revisão com o hash da candidata) | `snapshot`/`plan` |

### Constantes COMPLETAS (copiar e usar; nunca abreviar)
```
PACKAGE_VERSION      = 1.0.2-draft
REV2_SEMANTIC_HASH   = 33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd
REV1_SEMANTIC_HASH   = e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d
SOURCE_SHA256        = 6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904
CONFIRM_TOKEN        = REGISTER_CANDIDATE_DRAFT:<ORG_ID>:<IDENTITY_ID>:33ee30bc76b7      (12 primeiros hex do REV2_SEMANTIC_HASH)
```
Valores que **só o snapshot fornece** (não existem neste documento): `<IDENTITY_ID>`, `<REV1_ID>`, `<BINDING_ID>`, as 5 dimensões do escopo, `<DATABASE_NAME>` (nome do banco realmente conectado).

## 1. Responsáveis (decisões humanas)

| Decisão | Quem decide | Papel mínimo no sistema | Observação |
|---|---|---|---|
| D0 — prosseguir com a Revisão 2 | Owner do produto | — | Autoriza cada etapa **separadamente** |
| D1 — conteúdo/ato da **evidência jurídica** | Procuradoria/Jurídico do órgão (competência externa ao sistema) | registra: `manager` | Ver §3. O sistema **não valida competência** (`NOT_VALIDATED_POLICY_PENDING`) e **não inventa** parecer, data ou fundamento |
| D2 — registrar o DRAFT | Operador técnico designado, **autenticado pela própria credencial do sistema** | `operator` (membro ATIVO da org) + autoridade declarada em arquivo | Ferramenta controlada; só DRAFT + procedência; o ator registrado é o usuário autenticado |
| D3 — aprovar | Gestor (≠ operador do D2, recomendado) | `manager` | Decisão distinta de publicar |
| D4 — publicar | Gestor | `manager` | O servidor recalcula a matriz; qualquer `BLOCKED` recusa |
| D5 — vincular (troca atômica) | Gestor | `manager` | Único passo com efeito em produção |
| D6 — retorno à Revisão 1 | Gestor / Owner | `manager` | Mesmo mecanismo do D5 |

## 2. Etapa 0 — pré-verificação (SOMENTE LEITURA)

```
pnpm tsx scripts/register-model-candidate.ts --mode=snapshot --organization-id=1 --json
pnpm tsx scripts/register-model-candidate.ts --mode=plan --organization-id=1 --identity-id=<IDENTITY_ID> --package-version=1.0.2-draft \
  --expect-semantic-hash=33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd \
  --expect-baseline-hash=e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d \
  --expect-source-sha256=6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904
```
(executar num shell com `DATABASE_URL` e o build implantado; ambos os modos **apenas leem** e não exigem credencial, `--allow-production` nem confirmação.)

**PARE se:** qualquer verificação do plano estiver `FALHA`; a identidade não tiver a Revisão 1 `PUBLISHED` com o hash esperado; houver ≠ 1 vínculo ativo
para a identidade; já existir revisão com o hash da candidata em estado inesperado; a flag da org 1 estiver desligada; o commit implantado não contiver o merge `73a3d65a`.
Conferência cruzada opcional (SQL somente leitura, Apêndice A).

## 3. Etapa 1 — evidência jurídica (decisão D1; fora do sistema)

A matriz de prontidão (`LEGAL_APPROVAL_EVIDENCE`) exige **correspondência exata** entre (a) a versão lógica e o SHA-256 da procedência e (b) o hash semântico da **revisão exata**.
Para a candidata: versão lógica `1.0.2-draft`, SHA-256 `6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904`, hash semântico `33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd`.

- A Procuradoria aprovou o Modelo-Mestre `1.0.1-draft` (mesmo SHA-256 da fonte). O rótulo `1.0.2-draft` e a mudança de política de completude (7 dados de publicação deixam de bloquear a
  composição; AST, mapeamento e texto jurídico **idênticos**) **não** têm ato jurídico próprio. **Decisão humana necessária:** (A) a Procuradoria/gestor competente emite novo ato/parecer ou
  declaração que cubra a candidata, ou (B) o Owner decide, com a Procuradoria, que o ato existente cobre o conteúdo idêntico e registra essa base em `basisReference`/`reason`.
- Campos que a pessoa informa (nenhum é preenchido pelo sistema): autoridade declarada (nome, cargo, data do ato, base, motivo) e, **se existirem**, nº do parecer, data, protocolo, procurador e referências.
- **Isto é requisito de PUBLICAÇÃO DO MODELO. Não é, e não pode virar, gate para gerar um Edital** (a composição não consulta parecer, autorização nem módulo jurídico).

## 4. Etapa 2 — registrar o DRAFT (D2, ferramenta controlada)

**Guardas (valem em QUALQUER ambiente — `APP_ENV`/`NODE_ENV` são só rótulos e nunca dispensam nada):** toda execução exige (a) `--allow-production`, (b) `--confirm` exato com os identificadores e (c) `--expect-database` com o nome do banco, conferido contra o banco **realmente conectado** (divergência ⇒ recusa antes de autenticar ou escrever).

**Atribuição:** o ator é o **usuário autenticado** com a credencial do próprio sistema (e-mail + senha por variáveis de ambiente; **nunca por argumento**), membro ATIVO da organização com papel ≥ `operator`. `--actor-user-id` não existe mais. A autoridade declarada em `authority.json` é amarrada a esse usuário (um `decidedByUserId` diferente é recusado). Um id digitado ou o arquivo de autoridade **não** são autenticação.

`authority.json` (preenchido pela pessoa responsável): `{"decidedByName","decidedByRole","decidedAt":"AAAA-MM-DD","basisReference","reason"}`.
```
CANDIDATE_EXECUTOR_EMAIL='<e-mail do executor>' CANDIDATE_EXECUTOR_PASSWORD='<senha do executor>' \
pnpm tsx scripts/register-model-candidate.ts --mode=execute \
  --organization-id=1 --identity-id=<IDENTITY_ID> --package-version=1.0.2-draft \
  --expect-semantic-hash=33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd \
  --expect-baseline-hash=e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d \
  --expect-source-sha256=6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904 \
  --authority-file=authority.json \
  --confirm=REGISTER_CANDIDATE_DRAFT:1:<IDENTITY_ID>:33ee30bc76b7 \
  --expect-database=<DATABASE_NAME> --allow-production
```
Escreve **somente** uma revisão `DRAFT` (#2) + a procedência. Idempotente: repetir não cria segunda revisão; se um DRAFT ficou sem procedência (falha parcial), a repetição só completa a procedência.
**Verificar:** `snapshot` mostra 2 revisões (Revisão 1 `PUBLISHED` inalterada; candidata `DRAFT`, hash `33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd`, `candidateProvenance = CORRECT` — validação integral da procedência, §12.3), **1** vínculo ativo ainda fixando `<REV1_ID>`; as decisões de procedência no ledger têm `recorded_by_user_id` = o usuário autenticado e correlation id `cand-reg-…`; UI → Prontidão: `SOURCE_PROVENANCE = PASS`, único `BLOCKED` = `LEGAL_APPROVAL_EVIDENCE`.
**PARE se:** a ferramenta recusar qualquer guarda ou a autenticação (não insistir com outra credencial sem decisão do Owner); o hash da candidata divergir; aparecer 2ª revisão candidata; o vínculo ou a Revisão 1 mudarem. **Retorno:** nada a desfazer em produção (DRAFT não tem efeito); opcionalmente deixar o DRAFT parado.

### 4.1 Limitações conhecidas da atribuição (decisão do Owner aceitá-las ou exigir mais)
- A autenticação prova **conhecimento da credencial** do usuário (a mesma do login do sistema); não prova posse de dispositivo nem a identidade física de quem está no terminal — o sistema **não tem MFA**.
- **Não há limitação de tentativas entre invocações** (o limitador do login é em memória do servidor web); a execução exige acesso de shell/banco à infraestrutura, então o risco é de quem já a tem. Recomenda-se rodar a partir de sessão de infraestrutura já auditada e trocar a senha do executor após o uso.
- Quem tem escrita direta no banco pode alterar credenciais/ledger fora desta ferramenta; isso está fora do alcance deste controle.
- O contexto operacional (usuário do SO, host, pid, rótulo de ambiente) vai ao log estruturado como **informação não autenticada**.
- Este controle autentica quem **registra o DRAFT**. Aprovar, publicar e vincular continuam pela UI/API com a sessão autenticada normal do sistema (papel `manager`), cada uma com sua própria decisão no ledger.

## 5. Etapa 3 — evidência (D1 executado) → matriz `READY`
UI `/modelos-institucionais/<IDENTITY_ID>` → Governança (papel `manager`): registrar a evidência com versão lógica `1.0.2-draft` e SHA-256 `6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904` + os dados que a pessoa tem.
**Verificar:** Prontidão → `overall = READY` (0 `BLOCKED`); hash da matriz anotado. **PARE** em qualquer `BLOCKED`. Evidência com versão/SHA diferentes mantém o bloqueio (provado em teste).

## 6. Etapa 4 — aprovar (D3) e 7. Etapa 5 — publicar (D4)
UI → Revisões: aprovar a candidata (`DRAFT → APPROVED`), depois publicar (`APPROVED → PUBLISHED`; decisão distinta).
**Verificar:** candidata `PUBLISHED`; **Revisão 1 continua `PUBLISHED`** (publicar não deprecia nada); vínculo ativo **ainda** fixa `REV1_ID` (publicar não troca vínculo); decisão de publicação com `readiness.matrixHash`.
**Ponto de parada seguro:** Revisão 2 publicada e **não vinculada** = nenhum efeito sobre geração. **PARE** aqui até o Owner autorizar o vínculo.
**Retorno:** deixar a Revisão 2 publicada sem vínculo; ou depreciá-la (permitido só sem vínculo ativo).

## 8. Etapa 6 — vínculo (D5, ÚNICO passo com efeito)
UI → Vínculos → "Novo vínculo": selecionar a candidata + o **mesmo escopo (5 dimensões) do vínculo ativo**; a tela avisa "Este escopo já tem vínculo ativo… SUBSTITUÍDO numa única operação atômica" e envia `replacesBindingId = BINDING_ID`.
(Nunca usar "Desativar" + "Criar": deixaria o escopo sem vínculo e a geração voltaria ao legado.) A vigência do novo vínculo é carimbada pelo **servidor**; a tela não envia horário (ver §11).
**Verificar imediatamente:** exatamente **1** vínculo ativo, fixando a candidata, mesmo escopo; o antigo inativo; `bindings.resolve` do escopo → `RESOLVED` para a candidata; preparação de um processo mostra `capabilities.governedDraftRecomposition = true` e os 7 dados como "a preencher depois".
**Efeitos a comunicar:** novas composições usam a Revisão 2 (sem exigir número/cronograma). Rascunhos já compostos pela Revisão 1 continuam válidos (cada M1 aponta a revisão exata; a revalidação usa o M1). Regerar um rascunho existente passa a recompor (nova versão; anterior preservada). **Nenhum documento é gerado por este passo.**
**PARE se:** `BINDING_AMBIGUOUS`, `BINDING_NOT_PUBLISHED`, `SCOPE_INVALID`/escopo diferente, ou ≠ 1 vínculo ativo após a troca.

## 9. Retorno à Revisão 1 (D6) — a qualquer momento
UI → Vínculos → selecionar a **Revisão 1** + mesmo escopo → troca atômica (mesma tela). **Verificar:** 1 vínculo ativo fixando `REV1_ID`; `resolve` → Revisão 1; `capabilities.governedDraftRecomposition = false`.
A Revisão 1 **nunca** é depreciada nem editada neste rollout (permanece publicada e disponível para replay; provado em teste: M1 da Revisão 1 revalida `PASSED` com a Revisão 2 vinculada e após o retorno). A Revisão 2 permanece publicada (sem vínculo) para replay dos M1 que ela compôs.
Dados: nenhum rollback de dados (sem schema/migration; registros do ledger são append-only).

## 10. Critérios de PARE (gerais)
Qualquer divergência de identificador/hash; ≠ 1 vínculo ativo; matriz com `BLOCKED`; erro não previsto em qualquer etapa (não repetir às cegas — consultar `snapshot`); pedido para pular etapa, publicar sem evidência, vincular sem escopo idêntico ou alterar a flag/processo/documentos.

## Apêndice A — conferência SQL somente leitura (org 1)
```sql
SELECT id, slug, display_name FROM institutional_template_identities WHERE organization_id = 1 AND document_kind = 'edital';
SELECT id, identity_id, revision, status, semantic_hash, variable_catalog_version FROM institutional_template_revisions WHERE organization_id = 1 ORDER BY identity_id, revision;
SELECT id, identity_id, pinned_revision_id, active, scope_modality, scope_form, scope_platform, scope_regime, scope_criterion, effective_from_iso FROM institutional_template_bindings WHERE organization_id = 1 AND document_kind = 'edital';
```

## 11. Correções do amend corretivo (P1/P2) — contratos que o runbook assume

| Achado | Causa-raiz | Correção | Prova (MySQL real) |
|---|---|---|---|
| **P1 registro concorrente** | `plan → createDraft → procedência` sem exclusão: execuções simultâneas passavam no plano ao mesmo tempo e criavam `#2` e `#3` com o mesmo hash semântico; a 2ª procedência colidia na chave de idempotência e deixava DRAFT sem procedência. O esquema não tem unicidade por hash. | **Lock nomeado por (organização, identidade)** (`GET_LOCK` em conexão dedicada; nunca global entre tenants). Dentro do lock: flag relida, plano refeito, DRAFT existente reaproveitado, procedência ausente completada (retry limitado, mesma chave), pós-condição "exatamente 1 revisão com o hash". Mais de uma revisão com o hash (`CANDIDATE_UNIQUE`) ou revisão conflitante com o catálogo da candidata (`NO_CONFLICTING_REVISION`) ⇒ recusa sem escrever. **Sem migration** (uma restrição de unicidade por hash exigiria migration e arriscaria dados existentes). **Superado pelo §12.4:** o lock sozinho NÃO é garantia de integridade (a sessão dele pode morrer); a garantia agora é a escrita transacional exclusiva por hash. | 6 execuções simultâneas ⇒ 1 revisão, 1 só executor escreveu, todas convergem ao mesmo id; 2 órgãos em paralelo sem interferência; falha de procedência transitória (recuperada) e persistente (DRAFT retomado depois, também em paralelo, sem 2ª revisão) |
| **P1 swap sem janela `NOT_BOUND`** | A tela enviava `effectiveFrom = new Date()` do **navegador**; com relógio adiantado, o vínculo antigo era desativado e o novo só passava a valer no futuro ⇒ `NOT_BOUND` ⇒ fallback ao legado. | A vigência é do **servidor** (`ports.clock`, o mesmo relógio da geração): numa substituição o valor do cliente é **ignorado**; a rota é estrita e **não aceita** `effectiveFrom`; a tela não o envia. A troca já era uma única transação (desativar + criar); agora é também **convergente**: repetir a mesma troca (resultado incerto) ou troca concorrente idêntica devolve o vínculo ativo equivalente; troca conflitante ⇒ um vence, o outro é recusado. | relógio 2099 e 1999 ⇒ `effectiveFrom` = servidor e `RESOLVED` imediato; sondagem contínua da resolução durante 5 trocas sucessivas (R1↔R2): 0 leituras `NOT_BOUND`; retry convergente; 3 trocas idênticas paralelas ⇒ 1 vínculo; conflitantes ⇒ 1 ativo; tenant alheio ⇒ não encontrado |
| **P2 flag** | `registerCandidateDraft` não consultava `FF_INSTITUTIONAL_TEMPLATES_V1`. | Guarda **no servidor, antes da primeira escrita e dentro do lock**, na organização exata (`MODULE_DISABLED`). `plan` mostra `FLAG_ENABLED` e `snapshot` mostra a flag, ambos **somente leitura** e válidos com a flag desligada. | flag desligada ⇒ recusa com 0 revisões, 0 decisões, 0 eventos e vínculos intactos; tenant divergente; desligar entre plano e escrita ⇒ recusa |
| **P2 `absentText`** | O verificador aceitava qualquer `absentText`: o hash semântico cobre a AST e só a **versão** do catálogo, não o conteúdo dele. | Contrato campo a campo por variável diferida (`required=false`, `completionPolicy=DEFERRED_PUBLICATION`, `renderable` e `absentText` exatos) + **pino de SHA-256 do conteúdo canônico** do catálogo da candidata e da Revisão 1. | `absentText` alterado/variação de grafia/omitido, `required`, `completionPolicy` ou `renderable` adulterados em cada variável ⇒ recusa, mesmo com o hash declarado correto |

**Nota sobre o `absentText` das sete variáveis.** Seis são renderizáveis e exigem exatamente `A DEFINIR PARA PUBLICAÇÃO`. A sétima (`controle.dataDivulgacaoPrevista`) é variável **de controle** (`renderable=false`) e a regra de catálogo **proíbe** `absentText` nela; exigi-lo mudaria o catálogo e, com ele, o hash `33ee30bc…63c0cd`. O contrato exige, portanto, `absentText` ausente nesse campo.

**Contrato de idempotência.** Registro: chave de procedência determinística (`cand-prov-<org>-<identidade>-<hash16>`), lock por escopo, reaproveitamento por hash. Troca de vínculo: convergência por (identidade, revisão, escopo) ativos. Nada é regravado em repetição; o ledger é append-only.

**Riscos residuais.** (a) *(Tratado no §12.1: a resolução operacional não compara relógios; o risco de relógios de réplicas deixou de afetar a geração.)* (b) A flag é lida com o cache do `featureFlagService` (60 s) em processo de longa duração; o CLI roda em processo novo. (c) Revisões são imutáveis: uma falha de procedência persistente deixa um DRAFT sem procedência, **retomado** por nova execução (não removido). (d) Limitações da atribuição do CLI (§4.1) inalteradas: sem MFA e sem limite de tentativas. (e) A sequência D0–D6 e a autorização **separada** do Owner para cada etapa continuam exigidas; esta seção não executa nem autoriza nada.

## 12. Segundo amend corretivo — linearização temporal, convergência, procedência e resiliência do lock

Estado da revisão independente que motivou este amend: `PR293_INDEPENDENT_REVIEW_BLOCKED` (4 contraexemplos confirmados). Todos reproduzidos por teste **antes** da correção e verdes depois. Esta seção não executa nem autoriza nada em produção.

### 12.1 Contrato de linearização temporal (P1)

| Elemento | Contrato |
|---|---|
| **Autoridade do estado** | O **banco**: exatamente 1 vínculo ativo por (organização, tipo, escopo exato) — `uq_itb_active_scope` — e a revisão fixada por id exato. Relógio de aplicação **não** é autoridade de estado. |
| **Troca (swap)** | Uma transação: desativar o vínculo substituído + criar o novo (`replacesBindingId`). O **COMMIT é o ponto de linearização**: antes dele o leitor vê só o antigo; depois, só o novo; nunca zero nem dois. |
| **Leitura** | A leitura dos vínculos ativos é **uma única consulta** (leitura consistente); o resultado reflete o estado comitado naquele ponto. |
| **Vigência (`effectiveFrom`)** | Carimbada pelo **servidor** (`ports.clock`) na criação/troca; numa substituição o valor do cliente é ignorado; vigência **futura não é suportada** (recusada). É informativa e usada só na consulta **histórica**. |
| **Resolução OPERACIONAL** (composição nova, preflight, bridge do Edital, `bindings.resolve`/`previewBound` sem `asOf`) | `resolveCurrentTemplateBinding`: o vínculo **ativo** lido agora está em vigor; **nenhum** instante é capturado antes da leitura e nenhum relógio de aplicação é comparado com a vigência. Elimina a janela `NOT_BOUND` (leitor com `asOf` anterior ao carimbo da troca; relógios de réplicas com desvio; carimbo imediatamente posterior ao `asOf`). |
| **Resolução por `asOf` explícito** (API: `bindings.resolve`/`previewBound`/geração genérica com `asOf`) | `resolveTemplateBinding`: entre os vínculos **ativos**, vale o cuja vigência (`effectiveFrom`) é ≤ `asOf`. **Não é uma viagem no tempo** — vínculos desativados não são considerados e a persistência **não guarda o instante de desativação**, então não há como reconstruir quem estava vinculado em `asOf` depois de uma troca. O contrato é **fail-closed**: consulta anterior à vigência do vínculo ativo ⇒ `NOT_BOUND` (nunca devolve o vínculo novo retroativamente nem um modelo "atual" no lugar do histórico). Nenhuma tela usa `asOf`. Reconstituir o passado exigiria persistir o intervalo de vigência (migration) — fora do escopo e registrado como melhoria futura (P3). |
| **Replay oficial / histórico efetivo** | Não resolve vínculo: o passado oficial é o **manifest M1** (revisão exata e hash pinados, imutáveis) e o **ledger** de eventos/decisões (append-only). Esses registros respondem *"qual revisão compôs este documento"*; **não** respondem *"qual vínculo estava ativo em tal data"* (ver linha anterior). Provado: M1 da Revisão 1 revalida `PASSED` com a Revisão 2 vinculada e após o retorno. |
| **Novas composições** | Usam a revisão do vínculo ativo lido na hora; o manifest registra revisão/hash exatos. Duas leituras sucessivas (decisão do bridge e composição) podem ver revisões diferentes se uma troca ocorrer entre elas — ambas vinculadas, **nunca** legado. |

Hipóteses descartadas e por quê: *compensar relógios* (não resolve réplicas com desvio); *lock por escopo no caminho de leitura* (custo e risco de deadlock em toda geração para proteger uma janela que o contrato elimina); *DB time como autoridade de vigência* (ainda deixaria janela de microssegundos entre o carimbo e a leitura).

### 12.2 Convergência da troca (P2)

`setBinding` foi revisado inteiro. O vínculo a substituir é lido **primeiro** (por organização; de outro tenant ⇒ "não encontrado", sem sinal de conflito). Em seguida **uma leitura fresca** dos ativos: se já existe vínculo ativo **equivalente** (mesma organização, tipo documental, escopo exato, identidade e revisão fixada) no lugar do substituído, devolve-o (`template_binding_swap_converged`, fase `preflight`) **antes** de montar o conjunto de ambiguidade. Na escrita, falha por conflito de ativo/CAS ou **resultado incerto** (transporte) relê e converge só para o equivalente (fase `insert`). **Nunca** vira sucesso: erros de tenant/autorização/validação/estado (`TemplateWorkflowError` ≠ ambiguidade/conflito) e corrupção persistida; pedido conflitante (outra revisão) ⇒ `BINDING_AMBIGUOUS`. Sem evento duplicado (a transação perdedora faz rollback). **Limite:** a convergência é por **estado** (o ledger não guarda o id substituído no vínculo); a identidade de quem concluiu a troca está no evento `BINDING_CREATED` (ator e correlation id).

### 12.3 Validação integral da procedência (P2)

`plan`, `snapshot` e `register` comparam a procedência **corrente** (maior versão do ledger append-only, decodificada pelo contrato real de `importProvenance`) com a **projeção esperada** derivada do pacote versionado e da revisão exata — mesmas funções do registro (`summarizePackageInventory`, `PACKAGE_SOURCE_FORMAT`; nenhum segundo formato). Campos: `revisionId`, `revisionSemanticHash`, `templateKey`, `displayName`, `sourceLogicalVersion`, `sourceSha256`, `sourceFormat`, `inventory.sha256/inputsTotal/controlOnlyInputs/conditionTypes`, `scope.{modality,form,platform,regime,criterion}`.

| Estado | Significado | Ação |
|---|---|---|
| `ABSENT` | nenhuma decisão | só em DRAFT: recuperação idempotente governada (`RECORD_PROVENANCE`); fora de DRAFT ⇒ `PROVENANCE_NOT_RESUMABLE` (recusa) |
| `CORRECT` | corrente confere | converge **sem escrever** (`NONE`) |
| `DIVERGENT` | decodifica mas difere | **recusa** `PROVENANCE_DIVERGENT` com os campos (esperado × encontrado); **nada** é sobrescrito nem "consertado"; regularização humana = **nova versão** do ledger (a corrente passa a valer; v1 permanece) |
| `MALFORMED` | ilegível / outro tenant ou assunto | **recusa** `PROVENANCE_MALFORMED` (não é tratado como ausente) |

Procedência de outro conteúdo (p.ex. com o hash da Revisão 1) é `DIVERGENT` em `revisionSemanticHash`. O `snapshot` expõe `candidateProvenance` (CORRECT/ABSENT/DIVERGENT/MALFORMED/null). A recusa acontece **antes** de qualquer escrita (provado: contagem de decisões e revisões inalterada).

### 12.4 Resiliência do advisory lock (perda da sessão do lock)

**Risco confirmado (reproduzido com KILL da sessão que segura o lock):** o lock vive numa conexão dedicada e o trabalho roda em outras; se a sessão morre, o MySQL libera o lock, outro executor o adquire e o primeiro continua escrevendo ⇒ no estado anterior surgiam **2 revisões com o hash da candidata**.

**Mecanismo (o menor que de fato remove o risco):**
1. **Integridade na escrita, não no lock:** o DRAFT da candidata é criado por `insertDraftRevisionUnique` — na **mesma transação**: linha da identidade `FOR UPDATE` → checagem "já existe revisão com este hash?" → numeração lida sob o lock → `INSERT`. O lock da linha vive e morre **com a transação** (conexão que cai ⇒ nada comitado). Já existe ⇒ converge para a existente. A procedência já tinha chave de idempotência determinística + CAS (`expectedVersion`). **Sem migration.**
2. **Interrupção cedo (fail-closed):** o callback chama `held.assertHeld()` (`IS_USED_LOCK(nome) = CONNECTION_ID()`; sessão morta/outro dono ⇒ `AdvisoryLockLostError`, log `model_candidate_lock_lost`) antes de cada fase de escrita.
3. **Namespace do banco:** nome efetivo `lg<12 hex de sha256(DATABASE())>_<nome lógico>` (≤ 64; nome lógico ≤ 49; hoje 48). Bancos distintos no mesmo mysqld não disputam; o lock de **migração** não muda (nome fixo compartilhado com o release).
4. **RELEASE_LOCK que falha depois do trabalho** não mascara o resultado (log `model_candidate_lock_release_failed`); erro do trabalho sempre prevalece.
5. Conexão dedicada única por execução (não consome o pool); falha de abertura ⇒ falha fechada.

**O que NÃO está provado (honestidade):** `assertHeld` + escrita **não são atômicos** — a sessão pode morrer entre os dois; por isso a garantia está no item 1, provado com a sessão morta **depois** de `assertHeld` (LOCK-LOSS-2). Não foram testados failover de réplica, partição de rede prolongada nem reinício do mysqld com transações em voo (apenas `KILL` de sessão); o comportamento do item 1 nesses casos decorre da semântica transacional do InnoDB (rollback), não de teste próprio.

### 12.5 Provas (o que usou MySQL real × portas em memória)
- **MySQL real** (`templates-edital-deferred-publication-mysql-smoke`): `LIN-A…E` (barreiras determinísticas, sem `sleep`; transação de troca mantida aberta com as funções reais de persistência; swaps R1→R2→R1; relógios com desvio de 700 ms e 5 s; geração completa pela rota real), `SWAP-CONV` ×3 (A lê antigo → B comita → A retoma; conflitante; resultado incerto; tenant alheio), `PROV-*` (correta, ausente, 10 divergências campo a campo, procedência de outro conteúdo, ilegível, regularização, não retomável, tenant alheio), `LOCK-LOSS-1/2/3` (sessão realmente morta com `KILL`), `LOCK-NS` (dois bancos no mesmo mysqld).
- **Unit / portas em memória:** domínio de resolução corrente × histórica, comparador de procedência, conexão falsa do lock (assertHeld, RELEASE_LOCK falho, namespace), bridge do Edital sem `asOf`. Provam a lógica pura, **não** a concorrência real.
- Os testes de intercalação usam **barreiras** (promessas), nunca `sleep` probabilístico; o único polling (aguardar o servidor liberar o lock após `KILL`) é por condição observável, com limite.

### 12.6 Procedimento de reconciliação
- **Resultado incerto do registro** (erro/timeout após o comando): rodar `--mode=snapshot` e `--mode=plan`; `candidateRegistered` + `candidateProvenance=CORRECT` ⇒ concluído; `ABSENT` ⇒ repetir `execute` (idempotente); `DIVERGENT`/`MALFORMED` ⇒ **PARE**, regularização humana (nova versão da procedência pela governança), nunca apagar.
- **`AdvisoryLockLostError` / `model_candidate_lock_lost` no log:** a execução foi interrompida antes de novas escritas; rodar `snapshot`/`plan` e repetir `execute` — converge para a mesma revisão.
- **Troca de vínculo com erro/timeout:** conferir `bindings.list` (1 ativo, revisão esperada); repetir a mesma troca é idempotente (converge).

### 12.7 Auditoria consolidada final (rodada única) — achados e decisões
- **P2 corrigido — `template` informado × manifest (revision pinning).** O bridge do Edital decide o modelo (leitura 1) e depois compõe (leitura 2). Com a troca atômica, uma troca comitada entre as duas fazia o usuário ver a revisão A enquanto o M1 registrava a B. Agora a composição recebe `expectedRevisionId` e, se o vínculo mudou, falha **fechada e retentável** (`TEMPLATE_BINDING_CHANGED`, CONFLICT) sem escrever nada e sem cair no legado; o retry compõe pela revisão vigente e o `template` informado é o do M1 (teste `AUD-PIN`, vermelho sem a correção).
- **P3 corrigido na tela:** o botão de criar vínculo fica desabilitado enquanto a lista de vínculos carrega (evitava enviar criação sem `replacesBindingId` por lista ainda vazia; o servidor já recusava com `BINDING_AMBIGUOUS`). O CLI passou a mostrar o estado da procedência no `plan`.
- **Caminhos que criam revisão fora do mecanismo exclusivo (decisão):** `createDraft` comum (rota de rascunho, cópia a partir de revisão) e o registro de pacote não-candidato **não** usam `insertDraftRevisionUnique` — rascunhos de mesmo conteúdo são legítimos nesses fluxos. A exclusividade vale para o caminho **controlado de registro da candidata**, que é o que o runbook usa. Se outro caminho criar uma 2ª revisão com o hash da candidata, `plan`/`register` recusam (`CANDIDATE_UNIQUE`) sem escrever e exigem resolução humana (fail-closed). Nenhuma revisão é apagada.
- **Estresse (AUD-STRESS, MySQL real):** swaps idênticos e conflitantes + registros exclusivos + rascunhos comuns em paralelo, 3 rodadas: sempre 1 vínculo ativo, resolução `RESOLVED`, numeração de revisão sem colisão, nenhum deadlock vazando (a transação já tem retry de deadlock, SEM084-A).
- **Resultado incerto após commit do DRAFT:** a repetição recupera sem 2ª revisão e completa a procedência (`AUD-UNCERTAIN`). **Tenant:** a criação exclusiva é tenant-scoped (`AUD-TENANT`).
- **Mudança de comportamento a conhecer:** um vínculo ATIVO legado com `effectiveFrom` futuro (criado por versão antiga da tela com relógio de navegador adiantado) passa a valer imediatamente na resolução operacional (era o objetivo do vínculo; antes causava `NOT_BOUND`). Vigência futura não é mais aceita na criação.
