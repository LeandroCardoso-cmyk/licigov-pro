#!/usr/bin/env python3
"""
M8 — renumeração determinística da migration da PR-09 (0308 → 0309) no merge da PR-09 sobre um tree que JÁ
contém a PR-06 (0308_contract_number_unique_per_org). Executar na raiz do repositório, COM o merge da PR-09 em
andamento (conflitos em package.json, drizzle/meta/_journal.json, drizzle/meta/0308_snapshot.json e no smoke de
colaboração). Usado na integração descartável de 29/09/2026 (ver PRE_PR_BRANCH_INTEGRATION_MATRIX.md §3 W4.3/M8).

  1. package.json            → união do test:smoke:security (resolve_pkg equivalente; aqui: responsabilidade do integrador)
  2. smoke de colaboração    → versão HEAD (PR-06, genérica por journal) — M9
  3. meta/0308_snapshot.json → byte a byte o da PR-06 (HEAD)
  4. SQL                     → git mv 0308_edital… → 0309_edital…; cabeçalho, nota de NUMERAÇÃO e licigov_0308_* → 0309
  5. _journal.json           → entradas do HEAD (idx 308 = PR-06) + idx 309 = 0309_edital… com o `when` da PR-09
  6. meta/0309_snapshot.json → snapshot 0308 da PR-06 + tabela generated_documents da PR-09; id = o da PR-09;
                                prevId = id do 0308 da PR-06
  7. referências "0308" ADICIONADAS pela PR-09 (linha a linha, só nos arquivos da PR-09) → "0309"
Depois: `pnpm db:generate` deve responder "No schema changes" e o fix-up 0006 deve ser aplicado.
Uso: python3 m8-pr09-renumber-0309.py [<ref da PR-09>]   (default origin/fix/r5-pr09-regeneration-human-state)
"""
import subprocess, re, json, pathlib, sys
PR09 = sys.argv[1] if len(sys.argv) > 1 else "origin/fix/r5-pr09-regeneration-human-state"
def sh(*a): return subprocess.run(a, capture_output=True, text=True, check=True).stdout
sh("git", "checkout", "--ours", "--", "server/__tests__/integration/collaboration-stage-assignment-atomicity-mysql-smoke.test.ts")
sh("git", "checkout", "--ours", "--", "drizzle/meta/0308_snapshot.json")
sh("git", "mv", "drizzle/0308_edital_institutional_parameters.sql", "drizzle/0309_edital_institutional_parameters.sql")
p = pathlib.Path("drizzle/0309_edital_institutional_parameters.sql"); s = p.read_text()
s = s.replace("-- 0308 — PR-09", "-- 0309 — PR-09", 1)
s = re.sub(r"-- NUMERAÇÃO:.*", "-- NUMERAÇÃO: renumerada de 0308 para 0309 na integração (a 0308 é a da PR-06 — contract_number_unique_per_org;\n-- esta migration vem depois dela no journal). Ainda não aplicada em nenhum ambiente ⇒ mudança de hash sem impacto.", s, count=1)
p.write_text(s.replace("licigov_0308_", "licigov_0309_"))
theirs = json.loads(sh("git", "show", f"{PR09}:drizzle/meta/_journal.json"))
ours = json.loads(sh("git", "show", "HEAD:drizzle/meta/_journal.json"))
e09 = [e for e in theirs["entries"] if e["tag"] == "0308_edital_institutional_parameters"][0]
assert ours["entries"][-1]["tag"] == "0308_contract_number_unique_per_org" and ours["entries"][-1]["idx"] == 308
new = dict(e09); new["idx"] = 309; new["tag"] = "0309_edital_institutional_parameters"
assert new["when"] > ours["entries"][-1]["when"], "when da PR-09 deve ser posterior ao da PR-06 (monotônico)"
ours["entries"].append(new)
pathlib.Path("drizzle/meta/_journal.json").write_text(json.dumps(ours, indent=2) + "\n")
s06 = json.loads(pathlib.Path("drizzle/meta/0308_snapshot.json").read_text())
s09 = json.loads(sh("git", "show", f"{PR09}:drizzle/meta/0308_snapshot.json"))
snap = json.loads(json.dumps(s06)); snap["tables"]["generated_documents"] = s09["tables"]["generated_documents"]
snap["id"] = s09["id"]; snap["prevId"] = s06["id"]
pathlib.Path("drizzle/meta/0309_snapshot.json").write_text(json.dumps(snap, indent=2) + "\n")
skip = {"drizzle/meta/0308_snapshot.json", "drizzle/meta/_journal.json", "drizzle/0308_edital_institutional_parameters.sql",
        "package.json", "server/__tests__/integration/collaboration-stage-assignment-atomicity-mysql-smoke.test.ts"}
base = sh("git", "merge-base", "HEAD", PR09).strip()
for f in [f for f in sh("git", "diff", "--name-only", base, PR09).split() if f not in skip]:
    added = {l[1:] for l in sh("git", "diff", base, PR09, "--", f).splitlines() if l.startswith("+") and not l.startswith("+++") and "0308" in l}
    if not added: continue
    fp = pathlib.Path(f); lines = fp.read_text().split("\n"); n = 0
    for i, l in enumerate(lines):
        if l in added:
            nl = l.replace("idx: 308", "idx: 309").replace("0308", "0309")
            if nl != l: lines[i] = nl; n += 1
    fp.write_text("\n".join(lines)); print(f"{f}: {n} referência(s) 0308 → 0309")
print("snapshot 0309:", snap["id"], "prevId", snap["prevId"])
