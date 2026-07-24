# SOURCE-SCOPE-ROUTER-001 — Seleção determinística de fontes no "Tirar Dúvidas"

## Problema

Após as correções de retrieval e truncamento (RAG-QUALITY-001/002/003), o "Tirar Dúvidas" ainda
recuperava, por padrão, **todas** as fontes aplicáveis (Lei 14.133 + LC 123 + Decreto 11.462 + IN
SEGES 65 + manual/prejulgado TCE-PR + norma municipal) para qualquer pergunta — mesmo quando o
usuário citava um diploma específico ou fazia uma pergunta objetivamente respondível por uma única
norma. Efeitos indesejados: decretos/INs/jurisprudência/normas municipais apareciam como se fossem
sempre pertinentes; e regras **exclusivas do SRP** / **restritas ao Executivo federal** /
**condicionadas** eram apresentadas como se fossem obrigações municipais gerais.

## Solução — roteador determinístico de escopo ANTES do retrieval

Novo módulo de domínio PURO/DETERMINÍSTICO `server/domain/institutionalIntegration/sourceScopeRouter.ts`
(sem IA, sem I/O, sem estado). Dada a pergunta e os `normIds` disponíveis no contexto institucional já
resolvido, decide:

1. **Intenção** (ponto 8) — `normativa_objetiva | regulamentar | jurisprudencial | municipal |
   operacional | comparativa`, por precedência lexical determinística.
2. **Diplomas citados explicitamente** — só os que EXISTEM no contexto (nunca inventa fonte ausente;
   a revogada Lei 8.666, citada em perguntas comparativas, não vira restrição pois não está no corpus).
3. **Escopo inicial** — restrito ao(s) diploma(s) citado(s), ou irrestrito quando nenhum é citado.
4. **Ampliação solicitada pelo usuário** — quando a intenção pede fontes complementares
   (regulamentar/jurisprudencial/municipal) ou é comparativa (remissão normativa).

A aplicação do escopo e a eventual **ampliação (no máximo uma vez)** ficam na camada de integração
(`institutionalKnowledgeIntegration.ts`), opt-in por `enableSourceScopeRouting` — **ativo somente no
"Tirar Dúvidas"**; workspace/orchestrator e demais fluxos preservam o comportamento anterior (escopo
completo), sem regressão.

### Regras aplicadas (mapeamento ao pedido)

- **Ponto 1** — diploma citado ⇒ 1ª busca restrita a ele.
- **Ponto 2** — se a fonte citada responde, NÃO inclui decreto/IN/jurisprudência/municipal/outras leis
  automaticamente (elas ficam em `discardedNormIds`).
- **Ponto 3** — ampliação só quando o usuário pede regulamentação/jurisprudência/TCE, há remissão
  (comparativa), ou a 1ª busca é insuficiente (`coverageRatio < 0.5` ou `maxPassageScore < 0.15` ou
  zero passagens). No máximo uma ampliação.
- **Ponto 4** — persistência/auditoria: `intent`, `requestedDiplomas`, `initialScopeNormIds`,
  `expanded`, `expansionReason`, `includedNormIds`, `discardedNormIds`, `applicability` e `reasoning`
  vão para o `ContextPackage.metadata.sourceScope` (parte do `replayHash` → replay-safe), são
  persistidos no `contextSnapshot` da consulta, e emitidos como eventos `sourceScope` /
  `sourceScopeExpansion` (`[institutional-integration-observability]`).
- **Ponto 5** — `classifyApplicability(doc)`: `norma_federal_geral` (14.133, LC 123),
  `norma_executivo_federal` (Decreto 11.462, IN SEGES 65 — com `federalOnly`), `norma_municipal`
  (Lei Municipal 769), `jurisprudencia` (manual TCU / manual e prejulgado TCE-PR). Flags:
  `srpSpecific` (Decreto 11.462), `federalOnly`, `conditional`.
- **Ponto 6** — quando o contexto de um tenant **municipal** inclui norma exclusiva do SRP / do
  Executivo federal / condicionada, a resposta ganha uma **ressalva de aplicabilidade** explícita
  (nas `observations`): "não constitui, por si só, obrigação geral do município; confirme a
  adoção/regulamentação municipal".
- **Ponto 7** — "Qual artigo da Lei 14.133 trata da contratação direta?" ⇒ escopo restrito à Lei
  14.133 e recuperação dos **arts. 72, 73, 74 e 75** (o cluster completo do Capítulo VIII). Como a
  restrição a um único diploma reduz o total de documentos, o teto de passagens por documento sobe
  para 6 nesse caso (`SINGLE_DIPLOMA_MAX_PASSAGES`), permitindo caber o cluster inteiro (incl. o
  art. 73, o de menor score) sem perder concisão — cada trecho segue truncado (≈700 chars).

## Medição (corpus real)

| Pergunta | intent | incluídas | descartadas | arts (Lei 14.133) |
|---|---|---|---|---|
| Qual artigo da Lei 14.133 trata da contratação direta? | normativa_objetiva | **lei-14133** | decreto/IN/LC/TCE/municipal | 72, 73, 74, 75 |
| Segundo a Lei 14.133, quando é cabível a inexigibilidade? | normativa_objetiva | **lei-14133** | (idem) | 74 (topo) |
| Como funciona o sistema de registro de preços? | regulamentar | inclui **decreto-11462** | manual-tcu | — |
| Qual o entendimento do TCE-PR sobre dispensa? | jurisprudencial | inclui **manual/prejulgado TCE-PR** | manual-tcu | — |
| ME/EPP no meu município? | municipal | inclui **lei-municipal-769** | manual-tcu | — |
| Entendimento do TCE sobre contratação direta na Lei 14.133 | jurisprudencial | (restrito → **ampliado 1×**) | — | 72, 74, 75 |

Replay: mesma pergunta ⇒ mesmo `contextReplayHash` e mesmas `includedNormIds`.

## Testes

`server/__tests__/integration/source-scope-router-001.test.ts` (17 testes) cobre os 9 casos
obrigatórios + unidade do roteador + aplicabilidade + ponto 6 + tenant isolation:
- Lei 14.133 explícita → somente essa lei;
- inexigibilidade com lei explícita → art. 74, sem fontes desnecessárias;
- contratação direta geral → arts. 72–75, incluindo o art. 73;
- SRP → permite Decreto 11.462; TCE-PR → inclui corpus TCE-PR; municipal → inclui norma municipal;
- IN SEGES 65 classificada como `norma_executivo_federal`/`federalOnly`, nunca `norma_municipal`;
- ampliação no máximo uma vez + `knowledgeRetrieval`/`sourceScope` emitidos uma vez + exatamente 1
  registro de histórico (não duplica);
- replay reproduz o mesmo escopo, as mesmas fontes e o mesmo hash;
- tenant isolation preservado (outro tenant não recupera a norma municipal de Moreira Sales).

Ajuste pontual em `grounding-and-municipal-resolution.test.ts`: o teto de concisão por documento
passa a ser `≤6` no caso mono-fonte (escopo restrito a um diploma) e `≤3` no multi-fonte — a
exigência explícita do ponto 7 (4 artigos) supera a heurística anterior de `≤3` apenas quando o
escopo é restrito; o truncamento por trecho (≈700 chars) é preservado.

## Validação

- `tsc --noEmit`: 0 erros.
- `build`: sucesso.
- Suíte completa: **3898 passed / 92 skipped / 0 falhas** (RAG-QUALITY-003 deixou 3881; +17 novos,
  zero regressões após o ajuste do teto de concisão).

## Preservado

Tenant isolation, `correlationId`, replay (`replayId`/`replayOfExecutionId` continuam reservados a
replay explícito — o roteamento e a ampliação não são replay), lineage, citações e selos de evidência
(`evidenceSufficiency`). Sem migration/schema (auditoria persistida no `contextSnapshot` longtext já
existente).

## Fora do escopo

`@google/genai`, production, PR B, revogação da chave antiga — não tocados. Validação funcional final
depende do teste manual do usuário no staging.

---

## Adendo — 4 lacunas finais (pós-validação de staging)

### Lacuna 1 — aplicabilidade (SRP e Executivo federal)
- **Filtro de relevância SRP** (`applySrpRelevanceFilter`): fontes SRP-específicas (Decreto
  11.462/2023, marcado `srpSpecific`) só entram no universo de retrieval quando a pergunta tem
  **relação direta com o SRP** (`questionRelatesToSrp`: registro de preços / SRP / ARP / IRP / ata de
  registro) OU o diploma foi citado explicitamente. Em pergunta geral (ex.: ME/EPP municipal), o
  Decreto 11.462 deixa de ser incluído. Controle preservado: pergunta sobre SRP continua incluindo-o.
- **Ressalva reforçada**: quando norma do Executivo federal (IN SEGES 65) ou SRP integra o contexto
  de um tenant municipal, a resposta ganha a ressalva explícita de aplicabilidade + condição ("não
  constitui obrigação geral do município; confirme a adoção/regulamentação municipal").

### Lacuna 2 — selos (evidência × mérito)
`classifyEvidenceSufficiency` passa a exigir que a evidência **satisfaça a intenção** antes de poder
ser "fundamentada" (`intentEvidenceSatisfied`): consulta **jurisprudencial** sem NENHUM trecho de
fonte de jurisprudência (TCU/TCE/manual/prejulgado) → **"Evidência insuficiente"**; diploma **citado**
sem NENHUM trecho desse diploma → **"Evidência insuficiente"**. Ausência de fonte específica nunca é
classificada como resposta fundamentada ao mérito. Sem `sourceScope` (fluxos fora do Tirar Dúvidas), a
regra não se aplica — comportamento anterior preservado.

### Lacuna 3 — ambiguidade
`isAmbiguousConsultation`: referência anafórica sem antecedente concreto ("o que diz a legislação
municipal sobre **o tema**?") e sem termo de matéria identificável → a consulta **solicita
esclarecimento** e **não executa retrieval conclusivo**. Na camada de integração, o ContextPackage é
montado vazio (zero passagens) com `sourceScope.ambiguous=true`; em `answerConsultation` o provider
**não é chamado** (sem custo, sem alucinação); `buildConsultationAnswer` retorna a solicitação de
esclarecimento (status `limited`, selo `insuficiente`). Perguntas concretas não são afetadas.

### Lacuna 4 — corpus municipal (investigação + correção)
**Investigação:** o fixture da Lei Municipal nº 769 está corretamente ingerido — `tenantId=700001`,
`municipality="Moreira Sales"`, `jurisdiction="municipal"`, `status="vigente"`. A resolução o localiza
**apenas** quando (a) o tenant é 700001 **ou** (b) o perfil institucional da organização tem
`municipio="Moreira Sales"`. Em staging, uma organização real tem outro id e, se o cadastro não trouxer
o município "Moreira Sales", a norma municipal não é vinculada. **Causa raiz: dado/cadastro (município
do órgão não confirmado), não ingestão/metadata** — o fixture, o tenant e a classificação estão
corretos.
**Correção de código:** quando a pergunta é municipal, o tenant não vincula norma municipal, mas o
acervo **contém** fixture municipal (`corpusHasMunicipalFixture`), a resposta **não afirma ausência**
de normas municipais — registra que há normas municipais no acervo não vinculadas à organização e pede
a confirmação do município no cadastro (`municipalCorpusUnmatched`). Booleano de existência do fixture
— não expõe conteúdo de outro tenant (isolamento preservado).

### Testes e validação do adendo
`source-scope-router-001.test.ts` passa de 17 para 33 testes (novos blocos para as 4 lacunas +
roteamento mono-diploma preservado). Suíte completa: **3914 passed / 92 skipped / 0 falhas**. `tsc`/
`build` sem erros. Todos os testes verdes anteriores preservados; roteamento mono-diploma mantido.

---

## Adendo 2 — Isolamento estrito da lacuna 4 (correção de inferência cross-tenant)

A 1ª versão da lacuna 4 usava `corpusHasMunicipalFixture = corpus.registry.documents.some(municipal)`,
uma varredura **global** do corpus (todos os tenants). Ainda que retornasse só um booleano, isso é
**inferência cross-tenant** — a resposta a um tenant passava a depender da existência de fixture de
outro tenant. **Removido por completo.**

Correção (isolamento estrito):
- A verificação municipal usa **exclusivamente o tenant atual** — `municipalResolvedForTenant`, derivado
  de `institutional.applicableDocuments` (já resolvido com escopo do tenant). Nenhuma leitura do corpus
  de outro tenant, nem da existência de fixture alheio.
- Campo renomeado para `municipalNormUnavailableForTenant` (= intenção municipal **e** nenhuma norma
  municipal vinculada a **este** tenant). Removidos `corpusHasMunicipalFixture` e `municipalCorpusUnmatched`.
- Mensagem reescrita para falar **apenas do acervo do próprio tenant**: "O acervo institucional desta
  organização não possui norma municipal vinculada para esta consulta. Confira o cadastro do município
  do órgão ou solicite a inclusão da norma municipal no acervo institucional." — sem afirmar ausência
  global nem alegar existência em outro tenant.

Testes atualizados: um teste passa a **exigir a AUSÊNCIA** dos campos cross-tenant na auditoria de
escopo (`expect(audit).not.toHaveProperty("corpusHasMunicipalFixture" / "municipalCorpusUnmatched")`) e
a verificar que nenhuma mensagem alega existência em outro tenant nem ausência global. Suíte completa
após o Adendo 2: **3914 passed / 92 skipped / 0 falhas** (mesma contagem — refactor sem novos testes
líquidos além do de isolamento).

### Ação operacional (staging)
Investigação registrada em **`docs/ops/MUNICIPAL_CORPUS_STAGING_ACTION.md`**: a não localização da Lei
Municipal 769 em staging é de **cadastro** — a organização real tem `organizations.municipio` não
preenchido como "Moreira Sales" (e `id` ≠ 700001). Sem acesso ao banco de staging deste ambiente, não
é possível identificar o `id` da organização nem aplicar a configuração; a ação operacional documentada
pede ao operador: (2A recomendado) `UPDATE organizations SET esfera='municipal', uf='PR',
municipio='Moreira Sales' WHERE id=<org_real>` — resolve por município sem reingestão; ou (2B) reingerir
a Lei 769 sob o `tenantId` da organização real.


---

> **Validação de staging — CONCLUÍDA (2026-07-24).** O teste manual no staging foi
> concluído com sucesso, incluindo a Lei Municipal nº 769/2021 de Moreira Sales. Esta correção
> integra a PR consolidada `fix(ai): harden Gemini runtime and legal source retrieval`
> (commits `15ccc9e`..`d688680`). Gate: G12 → PASS (ver `docs/audits/production-readiness/INTERNAL_PRODUCTION_GATE.md`).
