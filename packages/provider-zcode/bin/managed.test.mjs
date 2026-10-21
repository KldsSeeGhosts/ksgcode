import { expect, it } from "vite-plus/test";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import {
  adoptInstallation,
  probeBridge,
  releaseVersion,
  rollbackInstallation,
  selectRelease,
  updateInstallation,
  verifyArtifact,
} from "./managed.mjs";

const previousRelease = "v0.72.0-ksg.20261015.1";
const nextRelease = "v0.72.0-ksg.20261015.2";

it("reports managed metadata when invoked as a standalone launcher", () => {
  const f = fixture();
  try {
    const launcher = NodePath.join(f.directory, "launch.mjs");
    NodeFS.copyFileSync(new URL("./managed.mjs", import.meta.url), launcher);
    const result = NodeChildProcess.spawnSync(process.execPath, [launcher, "--ksg-maintenance"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schema: 1,
      repository: "KldsSeeGhosts/zcode-acp",
      installedVersion: "0.72.0-ksg.20261015.1",
    });
  } finally {
    f.close();
  }
});

function fixture() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ksg-zcode-update-test-"));
  const file = NodePath.join(directory, "state.json");
  const prefix = NodePath.join(directory, "original");
  NodeFS.mkdirSync(prefix);
  NodeFS.writeFileSync(NodePath.join(prefix, "unchanged.txt"), "original bridge");
  const state = { schema: 1, release: previousRelease, prefix, runtimePath: "/native/zcode.cjs" };
  NodeFS.writeFileSync(file, JSON.stringify(state));
  const bytes = Buffer.from("verified release fixture");
  const manifest = {
    schema: "ksg.zcode-acp.artifact/1",
    artifact: {
      packageName: "zcode-acp-server",
      packedVersion: "0.72.0",
      tarball: "zcode-acp-server-0.72.0-ksg.fixture.tgz",
      tarballSha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
    },
  };
  return {
    directory,
    file,
    state,
    bytes,
    manifest,
    operations: {
      latest: async () => nextRelease,
      fetch: async (url) => {
        expect(
          url.startsWith(
            `https://github.com/KldsSeeGhosts/zcode-acp/releases/download/${nextRelease}/`,
          ),
        ).toBe(true);
        return new Response(url.endsWith("MANIFEST.json") ? JSON.stringify(manifest) : bytes);
      },
      install: async () => {},
      probe: async () => [
        "builtin:zai-coding-plan\\GLM-5.3",
        "builtin:zai-coding-plan\\GLM-5.3-Flash",
      ],
    },
    close() {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    },
  };
}

it("selects only published KSG releases, including same-native-version fork rebuilds", () => {
  const release = (tag_name, draft = false, published_at = "2026-10-15") => ({
    tag_name,
    draft,
    published_at,
  });
  expect(
    selectRelease([
      release("v0.99.0"),
      release("v0.99.0-ksg.20261015.1", true),
      release("v0.98.0-ksg.20261015.1", false, null),
      release(previousRelease),
      release("v0.72.0-ksg.20261015.10"),
      release(nextRelease),
    ]),
  ).toBe("v0.72.0-ksg.20261015.10");
  expect(() => selectRelease([release("v0.99.0")])).toThrow("No published KSG");
  expect(() => releaseVersion("v0.75.0")).toThrow("Not a KSG");
});

it("rejects corrupt payloads, foreign packages, and incorrect native versions", () => {
  const f = fixture();
  try {
    expect(() => verifyArtifact(f.manifest, f.bytes, nextRelease)).not.toThrow();
    expect(() => verifyArtifact(f.manifest, Buffer.from("corrupt"), nextRelease)).toThrow(
      "validation",
    );
    for (const artifact of [
      { ...f.manifest.artifact, packedVersion: "0.75.0" },
      { ...f.manifest.artifact, packageName: "another-package" },
      { ...f.manifest.artifact, tarball: "../outside.tgz" },
    ]) {
      expect(() => verifyArtifact({ ...f.manifest, artifact }, f.bytes, nextRelease)).toThrow(
        "validation",
      );
    }
  } finally {
    f.close();
  }
});

it("activates a verified rebuild atomically and retains the previous installation", async () => {
  const f = fixture();
  try {
    expect(await updateInstallation(f.file, f.operations)).toBe(true);
    const current = JSON.parse(NodeFS.readFileSync(f.file, "utf8"));
    expect(current.release).toBe(nextRelease);
    expect(current.previous).toEqual({ prefix: f.state.prefix, release: previousRelease });
    expect(current.prefix).not.toBe(f.state.prefix);
    expect(NodeFS.readFileSync(NodePath.join(f.state.prefix, "unchanged.txt"), "utf8")).toBe(
      "original bridge",
    );
    await rollbackInstallation(f.file, f.operations.probe);
    expect(JSON.parse(NodeFS.readFileSync(f.file, "utf8"))).toMatchObject({
      prefix: f.state.prefix,
      release: previousRelease,
      previous: { prefix: current.prefix, release: nextRelease },
    });
    expect(NodeFS.existsSync(current.prefix)).toBe(true);
  } finally {
    f.close();
  }
});

it("does not reinstall or downgrade an already current custom release", async () => {
  const f = fixture();
  try {
    const before = NodeFS.readFileSync(f.file, "utf8");
    const operations = {
      ...f.operations,
      latest: async () => previousRelease,
      fetch: async () => {
        throw new Error("must not download");
      },
    };
    expect(await updateInstallation(f.file, operations)).toBe(false);
    expect(NodeFS.readFileSync(f.file, "utf8")).toBe(before);
    NodeFS.writeFileSync(f.file, JSON.stringify({ ...f.state, release: nextRelease }));
    expect(await updateInstallation(f.file, operations)).toBe(false);
    expect(JSON.parse(NodeFS.readFileSync(f.file, "utf8")).release).toBe(nextRelease);
  } finally {
    f.close();
  }
});

it("retains the active bridge when Flash discovery or steering validation fails", async () => {
  for (const failure of ["models", "steering", "install", "checksum"]) {
    const f = fixture();
    try {
      const before = NodeFS.readFileSync(f.file, "utf8");
      const operations = {
        ...f.operations,
        install: async () => {
          if (failure === "install") throw new Error("Installation failed");
        },
        probe: async (prefix) => {
          if (prefix !== f.state.prefix) {
            if (failure === "steering") throw new Error("Missing steering");
            if (failure === "models") return ["builtin:zai-coding-plan\\GLM-5.3"];
          }
          return f.operations.probe();
        },
      };
      if (failure === "checksum") f.manifest.artifact.tarballSha256 = "0".repeat(64);
      await expect(updateInstallation(f.file, operations)).rejects.toThrow();
      expect(NodeFS.readFileSync(f.file, "utf8")).toBe(before);
      const versions = NodePath.join(f.directory, "versions");
      expect(NodeFS.existsSync(versions) ? NodeFS.readdirSync(versions) : []).toEqual([]);
    } finally {
      f.close();
    }
  }
});

it("does not replace state changed by another update while a download was in flight", async () => {
  const f = fixture();
  try {
    const concurrent = JSON.stringify({ ...f.state, release: "v0.72.0-ksg.20261015.3" });
    await expect(
      updateInstallation(f.file, {
        ...f.operations,
        install: async () => {
          NodeFS.writeFileSync(f.file, concurrent);
        },
      }),
    ).rejects.toThrow("changed during");
    expect(NodeFS.readFileSync(f.file, "utf8")).toBe(concurrent);
  } finally {
    f.close();
  }
});

function fakeBridge(directory) {
  const prefix = NodePath.join(directory, "bridge");
  const entry = NodePath.join(prefix, "node_modules/zcode-acp-server/dist/index.js");
  NodeFS.mkdirSync(NodePath.dirname(entry), { recursive: true });
  NodeFS.writeFileSync(
    entry,
    `
    const readline = require("node:readline");
    readline.createInterface({input: process.stdin}).on("line", (line) => {
      const request = JSON.parse(line);
      const result = request.method === "initialize"
        ? {_meta: {"t3code/steering": process.env.ZCODE_BIN === "missing-steering"
            ? {} : {version: 1, idempotent: true, holdsPrompt: true}}}
        : {configOptions: [{id: "model", options: process.env.ZCODE_BIN === "empty-models"
            ? [] : [{value: "GLM-5.3"}, {value: "GLM-5.3-Flash"}]}]};
      console.log(JSON.stringify({jsonrpc: "2.0", id: request.id, result}));
    });
  `,
  );
  return { prefix, entry };
}

it("probes the actual ACP protocol and refuses missing steering or model discovery", async () => {
  const f = fixture();
  try {
    const { prefix } = fakeBridge(f.directory);
    expect(await probeBridge(prefix, { runtimePath: "valid" })).toEqual([
      "GLM-5.3",
      "GLM-5.3-Flash",
    ]);
    await expect(probeBridge(prefix, { runtimePath: "missing-steering" })).rejects.toThrow(
      "steering",
    );
    await expect(probeBridge(prefix, { runtimePath: "empty-models" })).rejects.toThrow("models");
  } finally {
    f.close();
  }
});

it("validates adoption before changing settings and preserves unrelated configuration", async () => {
  const f = fixture();
  try {
    const { prefix, entry } = fakeBridge(f.directory);
    const settingsPath = NodePath.join(f.directory, ".t3/userdata/settings.json");
    NodeFS.mkdirSync(NodePath.dirname(settingsPath), { recursive: true });
    const managed = NodePath.join(f.directory, ".local/lib/ksg-providers/zcode-acp/managed");
    const args = ["--adopt", prefix, "--release", previousRelease, "--runtime", entry];
    await expect(adoptInstallation(["--adopt", prefix], f.directory)).rejects.toThrow(
      "required --release",
    );
    NodeFS.writeFileSync(settingsPath, JSON.stringify({ providerInstances: {} }));
    await expect(adoptInstallation(args, f.directory)).rejects.toThrow("No existing ZCode");
    expect(NodeFS.existsSync(managed)).toBe(false);
    const settings = {
      providerInstances: {
        zcode: {
          driver: "zcode",
          enabled: true,
          config: { binaryPath: "original", customModels: ["custom"] },
        },
        other: { driver: "other", enabled: false },
      },
      unrelated: "retained",
    };
    NodeFS.writeFileSync(settingsPath, JSON.stringify(settings));
    await adoptInstallation(args, f.directory);
    const current = JSON.parse(NodeFS.readFileSync(settingsPath, "utf8"));
    expect(current.providerInstances.zcode.config.binaryPath).not.toBe("original");
    expect(current.providerInstances.zcode.config.customModels).toEqual(["custom"]);
    expect(current.providerInstances.other).toEqual(settings.providerInstances.other);
    expect(current.unrelated).toBe("retained");
    expect(
      JSON.parse(NodeFS.readFileSync(NodePath.join(managed, "state.json"), "utf8")).prefix,
    ).toBe(prefix);
    expect(
      JSON.parse(NodeFS.readFileSync(NodePath.join(managed, "settings.before.json"), "utf8")),
    ).toEqual(settings);
    await expect(adoptInstallation(args, f.directory)).rejects.toThrow("already managed");
  } finally {
    f.close();
  }
});
