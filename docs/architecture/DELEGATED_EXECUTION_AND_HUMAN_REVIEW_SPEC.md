# Execução delegada e revisão humana — especificação mínima (não implementada)

> **Status:** especificação para decisão do Owner (nov/2026, saneamento P0 da auditoria pré-emissão H5). Nada aqui foi implementado:
> envolve migration aditiva e contratos protegidos (revalidação/M2). Implementar só com autorização específica.

## 1. O que o P0 já resolveu (implementado)

| Risco | Situação |
|---|---|
| Atribuir decisão à conta de outra pessoa (`decidedByUserId` livre) | **Corrigido**: `decidedByMatchesRecorder` no ledger, em `resolveAuthority` e no CLI (`DECISION_AUTHORITY_NOT_ACTOR`) |
| Roteiros de homologação declarando conferência / reconhecendo desvios | **Contido**: helpers `MECHANISM_ONLY`, guarda de afirmação e varredura estática |
| Regra para agentes | **Explícita** em `CLAUDE.md` |

## 2. Riscos residuais (não resolvidos pelo P0)

1. **R-A — Automação indistinguível no ato.** O ato eletrônico grava `decidedByUserId = recordedByUserId` e não há canal/executor; um agente que
   usa a sessão de uma pessoa gera "decisão pessoal" dela. Indispensável resolver **antes de uso real com agentes** operando contas de servidores.
2. **R-B — Revisão humana não registrada por trecho.** `saveReviewableDraft` grava só `actorUserId` (`reason` nulo); o M2 não diz quem resolveu
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

**E2 — Resolução humana de slot (resolve R-B; contrato protegido).** Decisão `slot_resolution` (`HUMAN_TEXT` | `DECLARED_NONE`, hash do texto,
nota) no ledger existente; a revalidação exige, para cada slot pendente do M1, aceite de IA OU resolução humana coerente com o conteúdo; o M2
registra as resoluções (nova versão do formato, leitores antigos preservados). `note` opcional em `saveReviewableDraft`. Sem tela nova: o
editor já existente oferece "declarar que não há obrigações adicionais" e "salvar trecho redigido" por slot.

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
| E2 | **indispensável** para emitir com slots de IA pendentes | **indispensável** |
