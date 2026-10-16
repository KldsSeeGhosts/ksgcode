// @effect-diagnostics nodeBuiltinImport:off - electron-builder calls this hook as a plain async function.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/**
 * KSG Code fork: the SHA-1 of the self-signed identity in CSC_KEYCHAIN, a
 * keychain holding only the imported .p12. codesign accepts the identity even
 * though macOS does not trust the certificate.
 */
export async function resolveSelfSignedIdentity(keychain: string | undefined): Promise<string> {
  if (!keychain) {
    throw new Error(
      "T3CODE_MACOS_SELF_SIGNED needs CSC_KEYCHAIN set to the keychain holding the .p12.",
    );
  }
  const { stdout } = await execFile("/usr/bin/security", [
    "find-identity",
    "-p",
    "codesigning",
    keychain,
  ]);
  const hash = /\b([0-9A-F]{40})\b/.exec(stdout)?.[1];
  if (!hash) throw new Error(`No code signing identity in ${keychain}.`);
  return hash;
}

export default async function sign(options: SignOptions): Promise<void> {
  const selfSigned = process.env.T3CODE_MACOS_SELF_SIGNED === "true";
  await signApplication({
    ...options,
    ...(selfSigned ? { identity: await resolveSelfSignedIdentity(options.keychain) } : {}),
    batchCodesignCalls: true,
  });
}
