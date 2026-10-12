# Edital — Pregão Eletrônico — BLL · Revisão 2 (CANDIDATA)

**Status: CANDIDATA — NÃO publicada, NÃO vinculada, NÃO registrável pela API.** Nada neste diretório altera a Revisão 1 (publicada, congelada).

- Derivada da Revisão 1 (`../edital-pregao-eletronico-bll/`, catálogo `1.0.1-draft.c2`, hash semântico `e62297e1…da5d`).
- **Única mudança semântica:** política de completude `DEFERRED_PUBLICATION` nos 7 dados de publicação
  (`processo.numeroPregao`, `controle.dataDivulgacaoPrevista`, `processo.dataAbertura`, `processo.horarioAbertura`,
  `processo.dataInicioRecebimentoPropostas`, `processo.dataFimRecebimentoPropostas`, `processo.horarioFimRecebimentoPropostas`):
  `required: false` + `completionPolicy: "DEFERRED_PUBLICATION"` + `absentText: "A DEFINIR PARA PUBLICAÇÃO"`.
- AST, mapeamento, fonte jurídica aprovada (`approvedPackage.json`) e regras (`rules.json`) são os mesmos da Revisão 1; o catálogo ganha a versão
  `edital-pregao-eletronico-bll/1.0.2-draft.c3`, o que gera um novo hash semântico de revisão (`33ee30bc…63c0cd`).
- A matriz de autoridade (CERTAME_CONFIG / CERTAME_SCHEDULE) NÃO muda: os dados continuam sendo decisões do certame, só deixam de bloquear a composição.
- Publicar/vincular esta revisão é decisão do Owner, pelo fluxo governado existente (registro → evidência → aprovação → publicação → binding).
  O registro de pacote candidato exige autorização explícita no serviço (`allowCandidatePackages`); a API pública nunca o oferece.
