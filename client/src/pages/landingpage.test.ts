/**
 * feat(landing) — Guarda de fonte da landing institucional portada do Claude Design (opção A).
 * Padrão do projeto: varredura de fonte, vitest env "node", sem jsdom. Prova o contrato do port:
 *   - é um componente React de verdade (não um HTML standalone embutido);
 *   - o visual vive em landing.css e é escopado em `.lgv-landing` (não vaza para o design system);
 *   - o modo escuro segue a classe `.dark` do app (não apenas prefers-color-scheme);
 *   - CTAs comerciais apontam para rotas reais (/login, /solicitar-proposta) — sem âncoras mortas;
 *   - os assets são servidos de /landing/* (Vite public), não base64 embutido;
 *   - nenhum artefato do Claude Design (x-dc, style-hover, mustache) sobrou no código.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TSX = readFileSync(path.join(ROOT, "client/src/pages/LandingPage.tsx"), "utf8");
const CSS = readFileSync(path.join(ROOT, "client/src/pages/landing.css"), "utf8");

describe("LandingPage · port do Claude Design (opção A)", () => {
  it("é componente React com CSS co-locado e wrapper escopado", () => {
    expect(TSX).toContain('import "./landing.css"');
    expect(TSX).toContain('export default function LandingPage()');
    expect(TSX).toMatch(/className="lgv-landing"/);
  });

  it("CTAs apontam para rotas reais via wouter (sem âncora morta #proposta)", () => {
    expect(TSX).toContain('import { Link } from "wouter"');
    expect(TSX).toMatch(/href="\/login"/);
    expect(TSX).toContain('const PROPOSAL = "/solicitar-proposta"');
    // Nenhum CTA comercial deve usar Link para a âncora #proposta (isso é só id de seção).
    expect(TSX).not.toMatch(/href="#proposta"/);
  });

  it("estado de scroll controla a borda do header (não mustache {{ navBorder }})", () => {
    expect(TSX).toMatch(/data-scrolled=\{scrolled\}/);
    expect(TSX).toMatch(/window\.addEventListener\("scroll"/);
    // Sem interpolação mustache do Claude Design (ex.: `{{ navBorder }}`). Estilos inline do
    // React (`style={{ ... }}`) não casam com este padrão de `{{ palavra }}`.
    expect(TSX).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it("assets servidos de /landing/* (Vite public), não base64 embutido", () => {
    expect(TSX).toContain("/landing/logo-lockup.png");
    expect(TSX).toContain("/landing/central-de-controle.png");
    expect(TSX).toContain("/landing/consulta-normativa.png");
    expect(CSS).toContain('url("/landing/hero-bg.png")');
    expect(TSX).not.toMatch(/data:image\/(png|jpe?g);base64/);
  });

  it("não sobraram artefatos do Claude Design (x-dc / style-hover / DCLogic)", () => {
    for (const artefato of ["<x-dc", "style-hover", "style-active", "DCLogic", "<sc-if", "<helmet"]) {
      expect(TSX.includes(artefato)).toBe(false);
    }
  });

  it("tokens escopados em .lgv-landing e dark atrelado à classe .dark do app", () => {
    expect(CSS).toMatch(/\.lgv-landing\s*\{/);
    expect(CSS).toMatch(/\.dark \.lgv-landing\s*\{/);
    // Não deve depender de prefers-color-scheme para o dark (o app é class-based).
    expect(CSS).not.toMatch(/@media \(prefers-color-scheme:\s*dark\)/);
  });
});
