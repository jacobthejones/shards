import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clangPath = "/opt/homebrew/opt/llvm/bin/clang++";
const wasmLdPath = "/private/tmp/shards-rustup/toolchains/stable-aarch64-apple-darwin/lib/rustlib/aarch64-apple-darwin/bin/gcc-ld/wasm-ld";
const sourcePath = path.join(projectRoot, "native", "simulation.cpp");
const outputPath = path.join(projectRoot, "public", "simulation.wasm");

mkdirSync(path.dirname(outputPath), { recursive: true });
execFileSync(clangPath, [
  "--target=wasm32-unknown-unknown",
  "-O3",
  "-nostdlib",
  "-nostdinc++",
  "-ffreestanding",
  "-fno-builtin",
  "-fno-exceptions",
  "-fno-rtti",
  `-fuse-ld=${wasmLdPath}`,
  sourcePath,
  "-Wl,--no-entry,--allow-undefined",
  "-o", outputPath,
], { cwd: projectRoot, stdio: "inherit" });

console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
