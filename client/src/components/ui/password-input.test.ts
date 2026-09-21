/**
 * UX auth — PasswordInput (toggle acessível de mostrar/ocultar senha).
 *
 * Testes por varredura de fonte (padrão do projeto: vitest env "node", sem jsdom/testing-library).
 * Provam o CONTRATO do componente e a adoção nas superfícies canônicas de autenticação, sem alterar
 * arquitetura de auth. O toggle é local/visual e não persiste/loga o valor.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const PWD = read("client/src/components/ui/password-input.tsx");

describe("PasswordInput — contrato do componente", () => {
  it("inicia escondida (type=password) e alterna para text via estado local", () => {
    expect(PWD).toMatch(/useState\(false\)/);
    expect(PWD).toMatch(/type=\{show \? "text" : "password"\}/);
  });

  it("compõe sobre o Input canônico e usa os ícones Eye/EyeOff (sem nova dependência)", () => {
    expect(PWD).toMatch(/from "@\/components\/ui\/input"/);
    expect(PWD).toMatch(/import \{ Eye, EyeOff \} from "lucide-react"/);
  });

  it("o botão de toggle NÃO submete o formulário (type=button) e alterna o estado", () => {
    expect(PWD).toMatch(/type="button"/);
    expect(PWD).toMatch(/setShow\(\(v\) => !v\)/);
  });

  it("é acessível: aria-label dinâmico e aria-pressed refletindo o estado", () => {
    expect(PWD).toMatch(/aria-label=\{show \? "Ocultar senha" : "Mostrar senha"\}/);
    expect(PWD).toMatch(/aria-pressed=\{show\}/);
  });

  it("repassa os demais props ao input (preserva value/onChange/autoComplete/id/required)", () => {
    // O spread ANTES do type garante que autoComplete/value/onChange do call-site sejam preservados,
    // e que o `type` do toggle não seja sobrescrito pelo consumidor.
    expect(PWD).toMatch(/\{\.\.\.props\}[\s\S]*type=\{show \? "text" : "password"\}/);
  });

  it("não introduz logging/persistência do valor (toggle é apenas visual)", () => {
    // Mira PADRÕES DE CHAMADA reais (não a prosa da docstring): nenhuma escrita/telemetria do valor.
    expect(PWD).not.toMatch(/console\.\w+\(|localStorage\.|sessionStorage\.|fetch\(|\.track\(/);
  });
});

describe("PasswordInput — adoção nas superfícies de autenticação", () => {
  const surfaces: Array<{ file: string; autocompletes: string[] }> = [
    { file: "client/src/pages/Login.tsx", autocompletes: ["current-password"] },
    { file: "client/src/pages/Register.tsx", autocompletes: ["new-password"] },
    { file: "client/src/pages/RedefinirSenha.tsx", autocompletes: ["new-password"] },
    { file: "client/src/pages/AceitarConvite.tsx", autocompletes: ["new-password"] },
  ];

  for (const s of surfaces) {
    it(`${s.file} usa PasswordInput e não deixa <Input type="password"> remanescente`, () => {
      const src = read(s.file);
      expect(src).toMatch(/import \{ PasswordInput \} from "@\/components\/ui\/password-input"/);
      expect(src).toMatch(/<PasswordInput/);
      expect(src).not.toMatch(/<Input[^>]*type="password"/s);
    });

    it(`${s.file} preserva o autocomplete correto`, () => {
      const src = read(s.file);
      for (const ac of s.autocompletes) expect(src).toContain(`autoComplete="${ac}"`);
    });
  }

  it("RedefinirSenha mantém toggles INDEPENDENTES para senha e confirmação", () => {
    const src = read("client/src/pages/RedefinirSenha.tsx");
    const matches = src.match(/<PasswordInput/g) ?? [];
    expect(matches.length).toBe(2); // cada campo tem seu próprio PasswordInput (estado por instância)
  });
});
