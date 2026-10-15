// @effect-diagnostics nodeBuiltinImport:off - Mocks the plain Node signing hook's process boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import sign from "./sign-macos.ts";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));
vi.mock("node:child_process", async () => {
  const util = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [util.promisify.custom]: vi.fn() }) };
});

const execFile = vi.mocked(NodeUtil.promisify(NodeChildProcess.execFile));
const fingerprint = "2E04AEB33EE92A6F640866930C52F8687A3C40EE";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("T3CODE_MACOS_SELF_SIGNED", "");
  vi.stubEnv("T3CODE_MACOS_DEVELOPMENT", "");
  vi.stubEnv("T3CODE_MACOS_SIGNING_IDENTITY", "");
});

afterEach(() => vi.unstubAllEnvs());

it("batches codesign calls without changing existing signing options", async () => {
  const options = {
    app: "/tmp/T3 Code.app",
    identity: "Developer ID Application: T3 Tools, Inc.",
    keychain: "/tmp/t3code.keychain",
    provisioningProfile: "/tmp/t3code.provisionprofile",
    optionsForFile: () => ({
      entitlements: "/tmp/t3code.entitlements.plist",
      hardenedRuntime: true,
    }),
  } satisfies SignOptions;

  await sign(options);

  expect(signApplication).toHaveBeenCalledExactlyOnceWith({
    ...options,
    batchCodesignCalls: true,
  });
});

it("selects the pinned valid Apple Development identity and disables provisioning automation", async () => {
  vi.stubEnv("T3CODE_MACOS_DEVELOPMENT", "true");
  vi.stubEnv("T3CODE_MACOS_SIGNING_IDENTITY", fingerprint.toLowerCase());
  execFile.mockResolvedValue({
    stdout: `1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: Other"\n2) ${fingerprint} "Apple Development: Tested"`,
    stderr: "",
  });
  const options = {
    app: "/tmp/KSG Code.app",
    keychain: "/tmp/ksg-development.keychain-db",
    identity: "-",
    type: "distribution",
    identityValidation: false,
    optionsForFile: () => ({
      hardenedRuntime: true,
      timestamp: "https://timestamp.apple.com/ts01",
    }),
  } satisfies SignOptions;

  await sign(options);

  expect(execFile).toHaveBeenCalledExactlyOnceWith("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    options.keychain,
  ]);
  expect(signApplication).toHaveBeenCalledExactlyOnceWith({
    ...options,
    identity: fingerprint,
    type: "development",
    identityValidation: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    batchCodesignCalls: true,
  });
});

it.each([
  "",
  `1) ${fingerprint} "Developer ID Application: Wrong type"`,
  '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: Wrong certificate"',
])("refuses development signing without the pinned valid identity (%s)", async (stdout) => {
  vi.stubEnv("T3CODE_MACOS_DEVELOPMENT", "true");
  vi.stubEnv("T3CODE_MACOS_SIGNING_IDENTITY", fingerprint);
  execFile.mockResolvedValue({ stdout, stderr: "" });

  await expect(sign({ app: "/tmp/KSG Code.app", keychain: "/tmp/ksg.keychain" })).rejects.toThrow(
    "pinned, valid Apple Development identity is missing",
  );
  expect(signApplication).not.toHaveBeenCalled();
});

it.each([
  { keychain: undefined, fingerprint },
  { keychain: "/tmp/ksg.keychain", fingerprint: "" },
  { keychain: "/tmp/ksg.keychain", fingerprint: "not-a-fingerprint" },
])("rejects incomplete development configuration (%j)", async (config) => {
  vi.stubEnv("T3CODE_MACOS_DEVELOPMENT", "true");
  vi.stubEnv("T3CODE_MACOS_SIGNING_IDENTITY", config.fingerprint);

  await expect(
    sign({
      app: "/tmp/KSG Code.app",
      ...(config.keychain ? { keychain: config.keychain } : {}),
    }),
  ).rejects.toThrow("needs CSC_KEYCHAIN and T3CODE_MACOS_SIGNING_IDENTITY");
  expect(execFile).not.toHaveBeenCalled();
  expect(signApplication).not.toHaveBeenCalled();
});

it("rejects conflicting personal signing modes", async () => {
  vi.stubEnv("T3CODE_MACOS_DEVELOPMENT", "true");
  vi.stubEnv("T3CODE_MACOS_SELF_SIGNED", "true");

  await expect(sign({ app: "/tmp/KSG Code.app" })).rejects.toThrow("only one");
  expect(signApplication).not.toHaveBeenCalled();
});

it("preserves the legacy self-signed fallback", async () => {
  vi.stubEnv("T3CODE_MACOS_SELF_SIGNED", "true");
  execFile.mockResolvedValue({ stdout: `1) ${fingerprint} "KSG Code"`, stderr: "" });

  await sign({ app: "/tmp/KSG Code.app", keychain: "/tmp/ksg.keychain" });

  expect(signApplication).toHaveBeenCalledExactlyOnceWith({
    app: "/tmp/KSG Code.app",
    keychain: "/tmp/ksg.keychain",
    identity: fingerprint,
    batchCodesignCalls: true,
  });
});
