import type * as vscode from "vscode";
import type { TofuStore } from "@mdsig/core";

export class MementoTofuStore implements TofuStore {
  private readonly state: vscode.Memento;
  constructor(state: vscode.Memento) {
    this.state = state;
  }
  get(signer: string): string | undefined {
    return this.state.get<Record<string, string>>("mdsig.knownSigners", {})[signer];
  }
  async set(signer: string, pubkey: string): Promise<void> {
    await this.state.update("mdsig.knownSigners", { ...this.state.get<Record<string, string>>("mdsig.knownSigners", {}), [signer]: pubkey });
  }
}
