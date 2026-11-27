import { existsSync, mkdtempSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const root = resolve(import.meta.dirname, "../..");
const workspace = mkdtempSync(join(tmpdir(), "mdsig-it-"));
for (const f of ["valid-single.md", "tampered.md", "unsigned-trailer.md", "valid-cosigned.md", "valid-scoped-edited.md", "table-marker.md"]) cpSync(join(root, "test/fixtures/examples", f), join(workspace, f));
mkdirSync(join(workspace, ".vscode"));
writeFileSync(join(workspace, ".vscode/settings.json"), JSON.stringify({ "mdsig.verify.network": "never", "mdsig.warnFormatters": false }));

const local = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
process.env.MDSIG_TEST_CONFIG_DIR = mkdtempSync(join(tmpdir(), "mdsig-cfg-"));
await runTests({
  ...(process.env.CI || !existsSync(local) ? {} : { vscodeExecutablePath: local }),
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, "test/integration/suite/index.cjs"),
  extensionTestsEnv: { MDSIG_TEST_CONFIG_DIR: process.env.MDSIG_TEST_CONFIG_DIR },
  launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes", `--user-data-dir=${mkdtempSync(join(tmpdir(), "mdsig-ud-"))}`],
});
