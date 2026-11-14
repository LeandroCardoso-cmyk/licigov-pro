# Execução delegada e revisão humana — especificação mínima

> **Status (nov/2026):** **E2 implementada** (resolução humana de trecho pendente do Edital; sem migration — ledger e `body_json`
> existentes). **E1 NÃO implementada** (proveniência do ato / execução delegada): continua exigindo migration aditiva e autorização
> específica do Owner. A lacuna R-A permanece aberta.

## 1. O que o P0 já resolveu (implementado)

| Risco | Situação |
|---|---|
| Atribuir decisão à conta de outra pessoa (`decidedByUserId` livre) | **Corrigido**: `decidedByMatchesRecorder` no ledger, em `resolveAuthority` e no CLI (`DECISION_AUTHORITY_NOT_ACTOR`) |
| Roteiros de homologação declarando conferência / reconhecendo desvios | **Contido**: helpers `MECHANISM_ONLY`, guarda de afirmação e varredura estática |
| Regra para agentes | **Explícita** em `CLAUDE.md` |

## 2. Riscos residuais (não resolvidos pelo P0)

1. **R-A — Automação indistinguível no ato.** O ato eletrônico grava `decidedByUserId = recordedByUserId` e não há canal/executor; um agente que
   usa a sessão de uma pessoa gera "decisão pessoal" dela. Indispensável resolver **antes de uso real com agentes** operando contas de servidores.
2. **R-B — Revisão humana não registrada por trecho.** *(Resolvido pela E2 — ver §3.)* `saveReviewableDraft` grava só `actorUserId` (`reason` nulo); o M2 não diz quem resolveu
   cada slot pendente. Remover `[REVISAR]` satisfaz o gate de forma. Indispensável para emissão real com slots de IA.
3. **R-C — Não há executor de narrativa para slots de modelo** (só leitor). Evolução de produto, não de segurança.

## 3. Menor evolução proposta

**E1 — Proveniência do ato (resolve R-A).** Migration aditiva: `recorded_via` (`interactive` | `delegated_agent`, default `interactive`) e
`execution_metadata` (JSON: `authorizedByUserId`, `agentLabel`, `authorizationRef`) em `institutional_decisions` e `generated_document_edits`,
**fora** do `requestHash` (replay `idc-req-v1` intacto). Ator `delegated_agent` aceito só em ambiente/tenant de homologação
(`homologationDemonstrativeAllowed`); `assertHumanActor` continua recusando-o em produção. Ato delegado: `decidedByUserId = null` e base
"execução delegada; sem confirmação pessoal; não é ato do órgão". Canal declarado por cabeçalho assinado (HMAC, só staging) — atesta a automação
COOPERATIVA; a regra operacional continua indispensável. Arquivos: `drizzle/schema.ts` + migration, `server/db/institutionalDecisions.ts`,
`server/services/institutionalTemplates/{ports,authority,decisionRecorder,electronicAuthority,governedSourceService}.ts`,
`adapters/draftAdapter.ts`, `server/_core/context.ts`, router de modelos.

**E2 — Resolução humana de slot (resolve R-B) — IMPLEMENTADA.**
- **Ato:** `institutionalTemplates.reviews.resolveSlot` (piso `operator` + membership real; ator e órgão do contexto autenticado). Por
  trecho pendente (`[REVISAR: narrativa "…" pendente de redação supervisionada]`), a pessoa **redige** (`HUMAN_TEXT`) ou, só nos slots
  elegíveis, declara **"Não há conteúdo adicional"** (`DECLARED_NONE` ⇒ frase FIXA da política versionada `tpl-slot-policy/1`; elegíveis:
  obrigações específicas do contratado/contratante; justificativas de vedação, art. 49 da LC 123/2006 e finalidades de dados exigem
  redação; trecho em linha nunca admite a declaração). O servidor localiza o trecho (marcador ou âncoras da última resolução — nunca
  posição do cliente), grava a edição governada (`human_edit`, CAS pelo hash visto, idempotência) e a decisão
  `template_slot_resolution` (CAS por revisão) **na mesma transação**.
- **Regra única** (`server/domain/institutionalTemplates/slotResolution.ts`, usada pela emissão e pela tela): para cada slot pendente do
  texto composto, a última resolução humana do M1 exato precisa localizar o trecho emitido (âncoras) e conferir o hash (`HUMAN_TEXT`) ou a
  frase da política (`DECLARED_NONE`). Sem resolução ⇒ `AI_SLOT_UNRESOLVED` (apagar `[REVISAR]` não basta); trecho/entorno alterado ⇒
  `AI_SLOT_RESOLUTION_STALE` (registrar novamente; a tela reapresenta o texto atual). Os demais gates (fonte, linhagem, desvios, preço,
  late-bound, SoD) seguem intactos.
- **M2:** campo opcional `slotResolutions = { formatVersion: "tpl-slot-resolution/1", items[] }` (slot, tipo, decisão, revisão, hash, quem
  registrou), ausente quando não há slot pendente — M2 anteriores mantêm forma, hash e validação.
- **Desvio estrutural:** a âncora de bloco condicional é cortada no primeiro `[REVISAR` (`deviationAnchor`) — preencher o trecho ou o dado
  marcado não é mais acusado como "bloco removido".
- **Tela:** o painel "Revisão do modelo institucional" do Edital lista os trechos (estado, quem registrou) com "Registrar redação deste
  trecho" e, quando elegível, "Não há conteúdo adicional"; desabilitado enquanto o editor tem alterações não salvas.
- **Limites:** (1) o trecho é localizado pelo marcador ou pelas âncoras da última resolução — se o entorno for reescrito no editor, a tela
  orienta a reinserir o marcador; (2) a E2 registra QUEM clicou, não distingue automação usando a sessão de uma pessoa (isso é a E1).

**Fora de escopo (sem ganho demonstrado agora):** novas confirmações para elaboração/pré-visualização/exportação; digest POLICY por campo.

## 4. Testes exigidos (quando implementar)

E1: canal assinado válido/inválido/expirado; produção ignora; matriz de `assertHumanOrHomologationDelegate` (produção, org 1, slug, lista);
`requestHash` inalterado (replay de registros antigos converge); smoke MySQL da migration com a guarda append-only D10; smoke de segurança
(delegado em org real ⇒ `HUMAN_ACTION_REQUIRED`). E2: revalidação recusa marcador removido sem resolução; aceita `DECLARED_NONE` declarado por
pessoa; M2 com resoluções; replay de M2 antigo; smoke compose → resolução → emissão.

## 5. Classificação

| Item | Para uso real com servidores operando o sistema | Para uso real com agentes operando contas |
|---|---|---|
| P0 (implementado) | suficiente | necessário, não suficiente |
| E1 | recomendável | **indispensável** |
| E2 (implementada) | atende à emissão com slots de IA pendentes | necessária, não suficiente (falta E1) |
