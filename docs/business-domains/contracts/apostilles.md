# Apostilamentos (Apostilles)

O **apostilamento** é o registro de alterações contratuais que **não exigem termo aditivo**,
por serem simples anotações permitidas em lei (art. 136 da Lei 14.133/2021). No LiciGov Pro,
é um instrumento do `ContractWorkspace` (`server/domain/contractInstruments.ts`), exibido na
aba **Apostilamentos**.

Router: `createApostille` · Tabela: `contract_ws_apostilles`

## Quando usar apostilamento

| Situação | Descrição |
|---|---|
| **Reajuste** | Aplicação de índice de reajuste previsto no contrato. |
| **Alteração de gestor** | Troca do responsável pela gestão do contrato (`manager`). |
| **Alteração de fiscal** | Troca do responsável pela fiscalização (`inspector`). |
| **Alterações permitidas em lei** | Demais anotações que a legislação autoriza por apostila. |

> **Aditivo x Apostilamento:** mudanças que alteram o núcleo do ajuste (objeto, valor por
> negociação, prazo) tendem a exigir **aditivo**; anotações formais e reajustes contratualmente
> previstos são feitos por **apostilamento**. O **Adaptive Process Engine** ajuda a indicar
> qual instrumento cabe — sempre sujeito à decisão humana.

## Fluxo do apostilamento

```
Registrar apostilamento (tipo) → Minuta gerada automaticamente → Documento Final → Workspace: apostilado
```

Diferentemente do aditivo, o apostilamento **não passa, em regra, por fluxo de parecer
obrigatório**, e sua **minuta é gerada automaticamente** a partir do tipo selecionado, dos
dados do contrato e dos templates institucionais.

### 1. Registrar
O usuário seleciona o tipo (reajuste, gestor, fiscal, alteração legal) e informa os
parâmetros (novo índice, novo gestor, novo fiscal, etc.).

### 2. Minuta automática
O domínio gera automaticamente a **minuta de apostilamento**, apoiada em legislação e
templates. O DOCX/PDF final é produzido pelo **Document Engine** por referência. Toda a
minuta permanece **revisável** (com *reasoning*, *provenance* e *confidence*) antes da
consolidação.

### 3. Documento Final
Consolida-se o documento e o `status` do Workspace passa a `apostilado`. As alterações de
gestor/fiscal atualizam os campos `manager`/`inspector` do Workspace.

## Exemplo

```
Workspace: vigente
   └─ createApostille(tipo = reajuste, indice = IPCA)
        └─ minuta automática (revisável)
             └─ documento final → Workspace: apostilado
```

## Princípios

- **Minuta automática, revisão humana obrigatória:** automático não significa definitivo.
- **Determinístico e replay-safe:** IDs por `sha256`; sem `Date.now()`/`Math.random()`.
- **Sem duplicação:** documento referenciado via Document Engine.
- **Multi-tenant:** vinculado ao `organizationId` do Workspace.

## Fora de escopo

O apostilamento **não** executa o cálculo financeiro do reajuste sobre empenhos, nem
movimenta orçamento — apenas **documenta** formalmente a alteração.
