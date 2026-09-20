# F-LEGAL1 V1 — Closure & Pilot Reclassification

> **Data:** 2026-09-18  
> **Status:** `F-LEGAL1.1 = 100% CLOSED (V1)` · `F-LEGAL1.2 = 100% CLOSED (V1)`  
> **Natureza:** encerramento documental baseado em evidência já produzida por A3-RD1 e produção.  
> **Sem alteração de runtime, schema, referência jurídica ativa ou produção nesta mudança.**

## 1. Motivo da reclassificação

Os percentuais históricos de F-LEGAL1.1 (25%) e F-LEGAL1.2 (50%) descreviam um checkpoint anterior a A3-RD1.
Depois desse checkpoint, o contrato foi materializado no runtime, o manifesto V1 foi instalado, aprovado por
humano e ativado com hash pinado, o fluxo oficial passou a resolver a autoridade legal pelo reference set
governado, e a validação de valor oficial deixou de depender de thresholds hardcoded.

Portanto, manter F-LEGAL1.1/F-LEGAL1.2 como blockers pré-piloto passou a representar estado histórico,
não a realidade operacional.

## 2. Escopo V1 encerrado

O V1 declara cobertura fechada e determinística para 7 locators:

- Art. 74, I
- Art. 74, II
- Art. 74, III
- Art. 74, IV
- Art. 74, V
- Art. 75, I
- Art. 75, II

Overrides monetários 2026:

- Art. 75, I: 13098420 centavos
- Art. 75, II: 6549211 centavos

Qualquer locator fora dessa lista continua retornando `LEGAL_REFERENCE_UNSUPPORTED`.
Isso é comportamento intencional, fail-closed e explicitamente permitido pelo contrato V1:
cobertura parcial governada é preferível a aproximação/fabricação jurídica.

## 3. Evidência de A3-RD1

O mecanismo técnico implementa:

- `legal_reference_sets`, `legal_reference_entries`, `legal_value_overrides`;
- coverage manifest determinístico;
- canonical content hashing;
- instalação INSERT/no-op/fail-closed;
- temporal resolution exactly-one;
- source lineage;
- approval hash;
- eventos de lifecycle;
- resolução governada por canonical locator;
- value override temporal;
- MySQL smoke;
- bridge governada para Contratação Direta;
- separação explícita entre identidade legacy e governada.

## 4. Evidência de produção

Deployment de ativação histórica:

`14db48d9-60ed-4d11-800e-c796b03d02cd`

Evidência registrada nos logs:

- `setId=1`
- `version=1`
- hash `332a9cb3ff8477eddc5cf94790a13d7ea9bd7a8c5855078f7f567f5400196832`
- aprovação humana explícita
- `status=active`
- correlationId persistido
- `PASS`

O deployment posterior de produção do SHA `b1d782844dc5df75b167d63c30ba8277f6695b95`
executou `pnpm db:release:predeploy`; a instalação retornou `noop` para o mesmo set/hash e não executou
nova ativação.

## 5. Fluxo oficial

O caminho governado usa:

- `resolveGovernedReference`;
- `getGovernedCatalog`;
- `validateGovernedValue`;
- reference set/version/locator persistidos;
- Cognitive Kernel para raciocínio;
- validação humana obrigatória.

O helper `validateValue` com limites históricos permanece somente como compatibilidade `@legacy`
e não é autoridade do fluxo governado.

## 6. Expansão de cobertura

Expandir a cobertura além do V1 NÃO deve editar o V1.

Mudanças futuras exigem nova versão append-only do reference set, com:

1. fonte oficial vigente;
2. novo coverage manifest;
3. hashes recalculados;
4. revisão humana;
5. instalação em draft;
6. staging;
7. aprovação explícita;
8. ativação governada;
9. rollback pronto.

Essa expansão passa a ser classificada como **F-LEGAL1 V2 — evolução versionada**, não blocker do piloto V1.

## 7. Gate de piloto

Para o piloto V1:

- locators suportados → fluxo governado normal;
- locator fora da cobertura → degraded/fail-closed explícito;
- nenhuma aproximação;
- nenhum artigo fabricado;
- nenhuma decisão jurídica autônoma;
- decisão final sempre humana.

## 8. Resultado

`F-LEGAL1.1 V1 = 100% — CLOSED`

`F-LEGAL1.2 V1 = 100% — AUTHORITATIVE CONTENT APPROVED + ACTIVE — CLOSED`

`F-LEGAL1 V2 = FUTURE / NON-BLOCKING`

Nenhuma mudança de conteúdo jurídico ou lifecycle foi executada por este fechamento documental.
