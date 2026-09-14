import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const llms = readFileSync(resolve(process.cwd(), "public/llms.txt"), "utf8");
const vercel = JSON.parse(
  readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
) as { rewrites: { source: string; destination: string }[] };

const BANNED =
  /\b(blockchain|crypto|wallet|token|web3|DAO|smart contract|on-chain)\b/i;

function spaRewriteSource(): string {
  const spa = vercel.rewrites.find((rule) => rule.destination === "/index.html");
  if (!spa) throw new Error("missing SPA rewrite to /index.html");
  return spa.source;
}

function spaRewriteMatches(pathname: string): boolean {
  return new RegExp(`^${spaRewriteSource()}$`).test(pathname);
}

describe("public /llms.txt", () => {
  it("is a facts-only brief with canonical URLs", () => {
    expect(llms).toMatch(/^# Stead\n/);
    expect(llms).toContain("https://openstead.app");
    expect(llms).toContain("2%");
    expect(llms).toContain("30 nights");
    expect(llms).toContain("merchant of record");
    expect(llms).toContain("https://openstead.app/explore");
    expect(llms).toContain("https://openstead.app/for-homeowners");
    expect(llms).toContain("https://openstead.app/host/start");
    expect(llms).toContain("https://openstead.app/login");
    expect(llms).toContain("https://github.com/nsheinbe/stead");
    expect(llms).toMatch(/Apache-2\.0/);
    expect(llms).toContain("Copyright 2026 Stead contributors");
    expect(llms).not.toMatch(BANNED);
  });

  it("treats an empty host-led catalog as honest", () => {
    expect(llms.toLowerCase()).toMatch(/empty/);
    expect(llms).not.toMatch(/Santa Monica/i);
  });
});

describe("SPA rewrite leaves static files alone", () => {
  it("does not swallow /llms.txt or other dotted public files", () => {
    expect(spaRewriteMatches("/")).toBe(true);
    expect(spaRewriteMatches("/explore")).toBe(true);
    expect(spaRewriteMatches("/for-homeowners")).toBe(true);
    expect(spaRewriteMatches("/host/start")).toBe(true);
    expect(spaRewriteMatches("/llms.txt")).toBe(false);
    expect(spaRewriteMatches("/favicon.ico")).toBe(false);
    expect(spaRewriteMatches("/assets/index.js")).toBe(false);
  });
});
