import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(projectRoot, "mobile-dist");

await rm(outputRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(join(outputRoot, "local"), { recursive: true }),
  mkdir(join(outputRoot, "local-dist"), { recursive: true }),
]);

await Promise.all([
  cp(join(projectRoot, "local-dist"), join(outputRoot, "local-dist"), { recursive: true }),
  cp(join(projectRoot, "local", "server.mjs"), join(outputRoot, "local", "server.mjs")),
  cp(join(projectRoot, "local", "mcp-bridge.mjs"), join(outputRoot, "local", "mcp-bridge.mjs")),
  cp(join(projectRoot, "mobile", "Iniciar-no-Android.sh"), join(outputRoot, "Iniciar-no-Android.sh")),
  cp(join(projectRoot, "mobile", "LEIA-ME.md"), join(outputRoot, "LEIA-ME.md")),
]);

await writeFile(join(outputRoot, "package.json"), `${JSON.stringify({
  name: "pentamark-mobile-host",
  version: "2.7.0",
  private: true,
  type: "module",
  scripts: { start: "node local/server.mjs" },
}, null, 2)}\n`, "utf8");

console.log(`\nPentaMark Mobile Host criado em ${outputRoot}\n`);
