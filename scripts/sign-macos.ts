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

/** Pin personal builds to the tested Apple identity, not another identity on the runner. */
export async function resolveDevelopmentIdentity(
  keychain: string | undefined,
  fingerprint: string | undefined,
): Promise<string> {
  if (!keychain || !fingerprint || !/^[0-9A-F]{40}$/i.test(fingerprint)) {
    throw new Error(
      "T3CODE_MACOS_DEVELOPMENT needs CSC_KEYCHAIN and T3CODE_MACOS_SIGNING_IDENTITY (certificate SHA-1).",
    );
  }
  const { stdout } = await execFile("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    keychain,
  ]);
  const expected = fingerprint.toUpperCase();
  const identities = [...stdout.matchAll(/\b([0-9A-F]{40})\s+"(Apple Development: [^"]+)"/g)];
  if (!identities.some((match) => match[1] === expected)) {
    throw new Error("The pinned, valid Apple Development identity is missing from CSC_KEYCHAIN.");
  }
  return expected;
}

export default async function sign(options: SignOptions): Promise<void> {
  const selfSigned = process.env.T3CODE_MACOS_SELF_SIGNED === "true";
  const development = process.env.T3CODE_MACOS_DEVELOPMENT === "true";
  if (selfSigned && development) {
    throw new Error("Choose only one personal macOS signing mode.");
  }
  await signApplication({
    ...options,
    ...(selfSigned ? { identity: await resolveSelfSignedIdentity(options.keychain) } : {}),
    ...(development
      ? {
          identity: await resolveDevelopmentIdentity(
            options.keychain,
            process.env.T3CODE_MACOS_SIGNING_IDENTITY,
          ),
          type: "development",
          identityValidation: true,
          preAutoEntitlements: false,
          preEmbedProvisioningProfile: false,
          strictVerify: true,
        }
      : {}),
    batchCodesignCalls: true,
  });
}
