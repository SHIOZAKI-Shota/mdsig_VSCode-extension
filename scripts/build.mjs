import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  external: ["vscode"],
  logLevel: "info",
};

const contexts = await Promise.all([
  esbuild.context({ ...common, entryPoints: ["src/node.ts"], outfile: "dist/node.js", platform: "node", format: "cjs", target: "node20" }),
  esbuild.context({ ...common, entryPoints: ["src/web.ts"], outfile: "dist/web.js", platform: "browser", format: "cjs", target: "es2022", mainFields: ["browser", "module", "main"] }),
  esbuild.context({ ...common, entryPoints: ["src/view/client.ts"], outfile: "dist/view.js", platform: "browser", format: "iife", target: "es2022" }),
  esbuild.context({ ...common, entryPoints: ["src/view/form.ts"], outfile: "dist/form.js", platform: "browser", format: "iife", target: "es2022" }),
]);

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
