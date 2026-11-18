import * as os from "node:os";
import * as path from "node:path";

export function userConfigDir(): string {
  if (process.env.MDSIG_TEST_CONFIG_DIR) return process.env.MDSIG_TEST_CONFIG_DIR;
  const home = os.homedir();
  if (process.platform === "win32") return process.env.APPDATA || path.join(home, "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(home, ".config");
}

export const mdsigConfigFile = (name: string) => path.join(userConfigDir(), "mdsig", name);
