# Ação operacional — Vínculo do corpus municipal (Lei Municipal nº 769) no staging

## Contexto (SOURCE-SCOPE-ROUTER-001, lacuna 4)

No "Tirar Dúvidas", perguntas municipais em staging não recuperavam a **Lei Municipal nº 769/2021 de
Moreira Sales**. A investigação de código confirmou que **não é bug de ingestão**: o fixture está
corretamente incorporado (ver `server/services/officialCorpus/officialCorpusBuilder.ts`):

- `normId = "lei-municipal-769-2021-moreira-sales"`
- `tenantId = 700001` (`MOREIRA_SALES_TENANT_ID`)
- `municipality = "Moreira Sales"`, `state = "PR"`, `jurisdiction = "municipal"`, `status = "vigente"`

## Causa raiz — dado/cadastro

A norma municipal é resolvida para uma consulta **apenas** quando (isolamento por tenant):

1. o `tenantId` da organização é **700001** (o tenant do fixture); **ou**
2. o **perfil institucional da organização** traz `municipio = "Moreira Sales"` (lido de
   `organizations.municipio` por `getOrganizationInstitutionalProfile`), caso em que a resolução casa
   o documento municipal por município.

A tabela `organizations` tem `municipio` **anulável e sem default** (`esfera` default `"municipal"`).
A organização real de staging tem um `id` próprio (≠ 700001) e, se `municipio` não estiver preenchido
como `"Moreira Sales"`, a norma municipal não é vinculada — daí a não localização.

> Isolamento: o código **não** consulta o corpus de outro tenant (nem a existência de fixture) para
> decidir isso. A resolução usa exclusivamente o tenant atual; a mensagem ao usuário fala apenas do
> acervo do próprio tenant.

## Ação operacional requerida (executar no staging — requer acesso ao banco)

Não tenho acesso ao banco de staging deste ambiente, portanto **não posso identificar o `id` da
organização real nem aplicar a configuração**. O operador deve:

### 1. Identificar a organização real de staging
```sql
SELECT id, nome, slug, esfera, uf, municipio FROM organizations WHERE ativo = 1;
```
Localize a organização usada nos testes do "Tirar Dúvidas" (pelo `nome`/`slug`).

### 2A. Opção recomendada — configurar o município no cadastro
Faz a norma municipal (fixture, tenant 700001) ser resolvida por município, sem reingestão:
```sql
UPDATE organizations
   SET esfera = 'municipal', uf = 'PR', municipio = 'Moreira Sales'
 WHERE id = <ID_DA_ORGANIZACAO_REAL>;
```
Validar depois: consultar "o que diz a legislação municipal de Moreira Sales sobre dispensa?" e
confirmar que a Lei Municipal 769 aparece nas fontes; e que o log `[institutional-integration-observability]`
mostra `sourceScope` com `municipalResolvedForTenant=true`.

### 2B. Alternativa — ingerir a Lei 769 sob o tenant correto
Se a política for vincular o documento diretamente ao `tenantId` da organização real (em vez de casar
por município), reingerir a Lei Municipal 769 com `tenantId = <ID_DA_ORGANIZACAO_REAL>` no builder do
corpus oficial. Mais invasivo (mexe no corpus/ingestão) e só recomendado se o modelo de tenancy
municipal mudar; a Opção 2A resolve sem tocar em código.

## Comportamento do sistema até a ação ser aplicada

Enquanto o vínculo não existir, o "Tirar Dúvidas" **não afirma ausência** de normas municipais:
informa que **o acervo institucional desta organização** não possui a norma municipal para a consulta
e orienta conferir o cadastro do município ou solicitar a inclusão da norma — sem qualquer inferência
sobre o corpus de outro tenant.
