import type * as vscode from "vscode";
import type { KnownSigners } from "../verify/tofu.ts";

const KEY = "mdsig.knownSigners";

export const mementoKnownSigners = (state: vscode.Memento): KnownSigners => ({
  read: async () => state.get<Record<string, string>>(KEY, {}),
  async update(change) {
    const current = { ...state.get<Record<string, string>>(KEY, {}) };
    change(current);
    await state.update(KEY, current);
  },
});
