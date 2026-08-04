# Toolchain reproduzível do Graphify — LiciGov Pro

Este diretório fixa, de forma **versionada e determinística**, a ferramenta que mantém o
grafo de conhecimento do repositório em [`graphify-out/`](../../graphify-out).

> **Regra Graphify-first:** consultar sempre `graphify-out/` antes de navegar o código;
> confirmar cada descoberta no código (o código é a verdade operacional); atualizar o grafo
> **somente após** as mudanças implementadas e validadas.

## Versão fixada

| Item | Valor |
|---|---|
| Pacote | `graphifyy` (PyPI) |
| Versão exata | **`0.9.32`** |
| Origem | PyPI — https://pypi.org/project/graphifyy/ — release estável mais recente (canal público, sem pré-release) em 2026-08-04 |
| CLI | `graphify` |
| Namespace/projeto | **raiz do repositório** (`graphify-out/.graphify_root = .`, projeto `licigov-pro`) — namespace único, não criar concorrente |

O pin está em [`requirements.txt`](./requirements.txt). **Nunca** instalar `graphifyy`
globalmente — sempre em ambiente Python isolado.

## Wrapper reproduzível (forma canônica)

Use SEMPRE o wrapper [`run.sh`](./run.sh): ele garante a versão exata fixada num venv isolado
(`.venv-graphify/`, gitignored) e executa a CLI. **Nunca** depende de instalação global.

```bash
# a partir da raiz do repositório — cria/atualiza o venv sob demanda e roda o comando
tools/graphify/run.sh update .          # atualiza o grafo (100% local, sem LLM)
tools/graphify/run.sh --version         # → graphify 0.9.32
```

Variável opcional `GRAPHIFY_VENV` aponta o venv para outro caminho (ex.: fora da árvore).

### Instalação manual equivalente (se preferir sem o wrapper)

```bash
python3 -m venv .venv-graphify
./.venv-graphify/bin/python -m pip install --upgrade pip
./.venv-graphify/bin/python -m pip install -r tools/graphify/requirements.txt
```

## Integração com o git hook

O `.githooks/pre-commit` chama **`tools/graphify/run.sh update .`** quando o commit toca
`server/` ou `client/`, re-incluindo os 4 artefatos versionados. Diferente da versão antiga,
**não há skip silencioso**: se a toolchain não puder rodar (sem `python3`/rede na 1ª instalação),
o hook **falha** com mensagem acionável em vez de deixar o grafo desatualizado.

- Extrai a AST de `server/`, `client/`, `shared/`, `docs/` etc. e reescreve
  `graphify-out/{graph.json,GRAPH_REPORT.md,manifest.json,.graphify_labels.json}`.
- A nomeação de comunidades por LLM (`graphify label`) é **opcional** e **não** é usada no fluxo
  determinístico: sem chave de API, o `update` nomeia comunidades pelo hub (determinístico).

## Notas de compatibilidade (validação 0.9.32 × grafo canônico)

Validação executada em **cópia isolada** do repositório (o `graphify-out/` canônico **não** foi
sobrescrito), comparando a build 0.9.32 no HEAD contra o grafo canônico:

| Dimensão | Canônico (`0fd50990`) | Build 0.9.32 (HEAD) | Veredito |
|---|---|---|---|
| Schema top-level | `built_at_commit, directed, graph, hyperedges, links, multigraph, nodes` | idêntico¹ | ✅ compatível |
| Schema de nó | 10 chaves (`id,label,source_file,…`) | **idêntico** | ✅ |
| Schema de aresta | 9 chaves (`source,target,relation,…`) | **idêntico** | ✅ |
| `directed` / `multigraph` | `false` / `false` | `false` / `false` | ✅ |
| Cobertura `server/` | 809 arquivos | 809 (0 a mais/menos) | ✅ |
| Cobertura `client/` | 572 arquivos | 572 (0 a mais/menos) | ✅ |
| Cobertura `shared/`,`drizzle/`,`docs/` | 4 / 2 / 200 | 4 / 2 / 200 | ✅ |
| Arquivos `.sql` no grafo | 0 | 0 | ✅ consistente² |
| Nós | 14 509 | 14 580 (**+71**) | ✅ explicado³ |
| Arestas | 29 040 | 29 347 (**+307**) | ✅ explicado³ |

¹ Na cópia de validação (sem `.git`) o campo `built_at_commit` fica ausente; no repositório real
  (com `.git`) o `graphify update .` o preenche com o commit corrente. Diferença de setup, não de versão.

² `tree_sitter_sql` **não** é instalado (nem era no canônico): os 288 arquivos `.sql` de
  `drizzle/` nunca contribuíram nós. **Não** adicionar o extra `graphifyy[sql]` — introduziria
  divergência estrutural frente ao grafo canônico.

³ Divergência **aditiva e benigna**: a 0.9.32 captura símbolos mais granulares em arquivos de
  código **inalterados** (nenhum arquivo de código mudou entre `0fd50990` e o HEAD). Ex.:
  `server/domain/authErrors.ts` passou de 3 → 21 nós (cada código de erro — `INVITATION_EXPIRED`,
  `RATE_LIMITED`, `TENANT_ACCESS_FORBIDDEN`… — agora é um nó); `shared/const.ts` 1 → 6
  (`COOKIE_NAME`, `ONE_YEAR_MS`…). **Zero nós perdidos**, schema estável, cobertura estável.
  O re-baseline de +71/+307 é assumido na primeira atualização canônica do grafo.
