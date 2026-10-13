# Dossiê de prontidão — Revisão 2 do `EDITAL_PREGAO_ELETRONICO_BLL`

Base: `main@73a3d65a2c43695cd22820cc7c07d198ddc4ad8c` (merge do PR #292). Escopo desta etapa: **verificação somente leitura + ferramenta controlada em PR separado**. Nada foi registrado,
aprovado, publicado ou vinculado em produção; a flag, o processo `2026/253`, documentos e dados reais não foram tocados. Runbook: `EDITAL_REVISION2_PUBLICATION_RUNBOOK.md`.

## 1. Produção — observado × não confirmado
**Observado (Railway, leitura):** serviço `licigov-pro`/production faz deploy automático da `main` (`checkSuites` ligado); deployment `7f02d043…` = SUCCESS, commit `73a3d65a…`, branch `main`;
pré-deploy `db:migrate:release` concluiu como no-op ("já em dia"); reference data `noop`; boot `[BOOT][production] Schema validado … Bootstrap concluído. Servidor pronto.`; porta 8080;
tráfego público respondendo `200` (`/` e chamadas tRPC de uma sessão do órgão 1); log de flag: `FF_INSTITUTIONAL_TEMPLATES_V1` resolvida para a org 1 com `enabled=true, percentage=100`.
**Não confirmado:** `/readyz` — o ambiente do agente não alcança o domínio (egress bloqueado / DNS) e o stream HTTP do Railway não registra o health check interno. O SUCCESS do deployment é o único sinal indireto.

## 2. Snapshot da org 1 — NÃO obtido
O banco de produção só é alcançável por TCP (proxy público) e o ambiente do agente tem saída apenas HTTPS pelo proxy; além disso, não li segredos de produção. **Pendente (humano):** rodar
`register-model-candidate --mode=snapshot --organization-id=1` (somente leitura) e/ou o SQL do Apêndice A do runbook, e anexar: identidade do modelo, revisão e hash vinculados, binding e suas 5 dimensões,
flag, e a ausência de registro prévio da Revisão 2. **Único dado de produção sobre a flag:** o log acima.

## 3. Pacote candidato — validado (código)
Verificado por `verifyCandidatePackage` (domínio puro; testes `institutional-templates-candidate-package` + os do PR #292): versão lógica `1.0.2-draft`; hash semântico `33ee30bc…63c0cd`;
Revisão 1 conserva `e62297e1…da5d` (arquivos congelados por SHA-256 em teste); mesma AST, mesmo mapeamento e mesmo pacote jurídico aprovado/SHA-256 da fonte (`6795b2ab…7904`);
catálogo difere **somente** em `required`/`completionPolicy`/`absentText` das 7 variáveis aprovadas; `DEFERRED_PUBLICATION` exatamente nelas; regras idênticas (só a versão do catálogo). Qualquer desvio ⇒ recusa (testado).

## 4. Caminho operacional autorizado para registrar o DRAFT
**Não existia** (a API pública não aceita `packageVersion`; o serviço exige `allowCandidatePackages`). Preparado em **PR separado (sem merge)**, sem bypass genérico e sem expor candidatos:

| Camada | Entrega |
|---|---|
| Domain | `candidatePackage.ts` — verificação pura candidato × linha de base |
| Services | `candidateRegistrationService.ts` — `plan` (leitura), `register` (DRAFT + procedência, idempotente, retoma procedência faltante), `snapshot` (leitura); `ModelRegistrationService.register` ganhou retomada interna de DRAFT |
| Database | sem mudança (mesmas tabelas/ledger); sem migration |
| Routers | **sem mudança** — nenhuma rota/preset novo; teste garante que o router não referencia o serviço/opção |
| Frontend | tela de Vínculos: troca de revisão no mesmo escopo = **substituição atômica** (`replacesBindingId`) com aviso; antes só havia "Desativar" + "Criar" (janela sem vínculo ⇒ geração voltaria ao legado) |
| CLI | `scripts/register-model-candidate.ts` — `snapshot`/`plan` (padrão, leitura) e `execute`: **em qualquer ambiente** exige `--allow-production`, confirmação exata `REGISTER_CANDIDATE_DRAFT:<org>:<identidade>:<hash12>` e `--expect-database` conferido contra o banco conectado (rótulos `APP_ENV`/`NODE_ENV` nunca dispensam); o ator é o **usuário autenticado** pela credencial do sistema (e-mail+senha por ambiente), membro ativo ≥ operator; `--actor-user-id` removido; autoridade amarrada ao autenticado |
| Testes | unit (pacote, CLI), SSR/lógica de cliente (troca atômica), MySQL smoke `SEQ`/`SEQ-PROV` |
| Docs | este dossiê + runbook |
Preservados: isolamento de tenant (todas as leituras/escritas por organização; identidade de outro tenant ⇒ recusa), CAS e idempotência (chave de procedência determinística; hash de revisão duplicado ⇒ nenhuma revisão nova), lineage (decisões no ledger append-only), observabilidade (`model_candidate_draft_registered`), replay (Revisão 1 e M1 intactos).

## 5. Evidência jurídica humana
A matriz exige evidência cuja **versão lógica + SHA-256** coincidam com a procedência e cujo **hash semântico** seja o da revisão exata (candidata: `1.0.2-draft` / `6795b2ab…` / `33ee30bc…`).
A Procuradoria aprovou a fonte `1.0.1-draft` (mesmo SHA-256); **o rótulo `1.0.2-draft` e a mudança de política de completude não têm ato jurídico próprio** — decisão humana (runbook §3): novo ato **ou**
base declarada de que o conteúdo é idêntico. Nada do parecer da Revisão 1 foi copiado/inventado. É requisito de **publicar o modelo**, não gate de geração de Edital (testes LEGAL1–LEGAL4 do PR #292).

## 6. Sequência validada em ambiente isolado (MySQL real, tenant sintético)
Registro DRAFT pela ferramenta → procedência → **sem evidência: único BLOCKED = `LEGAL_APPROVAL_EVIDENCE`, aprovar não publica e publicar é recusado** → evidência com versão errada continua bloqueando →
evidência correta ⇒ matriz `READY` → aprovação → publicação (Revisão 1 segue `PUBLISHED`, vínculo intacto) → sem `replacesBindingId` ⇒ `BINDING_AMBIGUOUS` (nada muda) → tenant cruzado ⇒ não encontrado →
**troca atômica** (exatamente 1 vínculo ativo) → replay da troca recusado → composição pela Revisão 2 sem número/cronograma → M1 da Revisão 1 revalida `PASSED` → **retorno à Revisão 1** (1 vínculo ativo; Revisão 2 segue publicada;
`capabilities.governedDraftRecomposition=false`) → hash e AST da Revisão 1 inalterados. Também: hash esperado errado, identidade de outro tenant e pacote candidato via serviço padrão ⇒ recusados sem criar nada;
DRAFT sem procedência ⇒ retomado sem 2ª revisão.

## 7. Pendências e decisões humanas
1. Snapshot da org 1 em produção (§2) e confirmação de `/readyz` (§1).
2. Decisão D1: evidência jurídica da candidata (§5) — inclusive se o rótulo `1.0.2-draft` deve permanecer.
3. Revisão/aprovação e merge do PR de preparação (ferramenta + tela de troca atômica) **antes** de usá-lo em produção (o CLI só existe depois do merge e do deploy desse PR).
4. Autorização separada para cada etapa do runbook (registrar → aprovar → publicar → vincular). Impacto do vínculo sobre processos em andamento (inclusive `2026/253`) a decidir pelo Owner (runbook §8).

## 8. Amend corretivo P1/P2 (registro concorrente, swap sem `NOT_BOUND`, flag, integridade do catálogo)
Ver runbook §11. Resumo: registro serializado por (organização, identidade) com reaproveitamento por hash e recusa de duplicata/conflito; vigência do vínculo carimbada pelo servidor e troca convergente; flag exigida antes da primeira escrita (plan/snapshot seguem leitura);
`absentText` e demais campos das 7 variáveis diferidas validados pelo conteúdo efetivo + pino de SHA-256 do catálogo. Sem migration; Revisão 1 inalterada.
