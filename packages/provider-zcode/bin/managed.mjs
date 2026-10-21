/* oxlint-disable t3code/no-global-process-runtime -- This standalone launcher runs outside T3 and cannot depend on its Effect runtime. */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export const repository = "KldsSeeGhosts/zcode-acp";
const releasePattern = /^v?(\d+\.\d+\.\d+-ksg\.\d{8}\.\d+)$/;
const self = NodeURL.fileURLToPath(import.meta.url);
const stateFile = NodePath.join(NodePath.dirname(self), "state.json");

export function releaseVersion(tag) {
  const version = releasePattern.exec(tag ?? "")?.[1];
  if (!version) throw new Error("Not a KSG ZCode release.");
  return version;
}

function compareVersions(left, right) {
  const a = releaseVersion(left).split(/[.-]/);
  const b = releaseVersion(right).split(/[.-]/);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return Number(a[i]) - Number(b[i]);
  }
  return 0;
}

export function selectRelease(releases) {
  const candidates = releases.filter(
    (release) =>
      release.draft === false && release.published_at && releasePattern.test(release.tag_name),
  );
  candidates.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  if (!candidates[0]) throw new Error("No published KSG ZCode release is available.");
  return candidates[0].tag_name;
}

async function download(url, maximumBytes, fetcher = fetch) {
  const response = await fetcher(url, {
    headers: { accept: "application/json", "user-agent": "ksg-zcode-updater" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`KSG release download failed (HTTP ${response.status}).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error("KSG release asset exceeds its size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function latestRelease(fetcher = fetch) {
  const bytes = await download(
    `https://api.github.com/repos/${repository}/releases?per_page=100`,
    2 * 1024 * 1024,
    fetcher,
  );
  return selectRelease(JSON.parse(bytes.toString("utf8")));
}

export function verifyArtifact(manifest, bytes, tag) {
  const artifact = manifest?.artifact;
  if (
    manifest?.schema !== "ksg.zcode-acp.artifact/1" ||
    artifact?.packageName !== "zcode-acp-server" ||
    !/^zcode-acp-server-[\w.-]+\.tgz$/.test(artifact?.tarball ?? "") ||
    !/^[a-f0-9]{64}$/.test(artifact?.tarballSha256 ?? "") ||
    artifact.packedVersion !== releaseVersion(tag).split("-")[0] ||
    NodeCrypto.createHash("sha256").update(bytes).digest("hex") !== artifact.tarballSha256
  ) {
    throw new Error("KSG bridge artifact failed manifest or checksum validation.");
  }
}

function bridgeEntry(prefix) {
  const entry = [
    NodePath.join(prefix, "node_modules/zcode-acp-server/dist/index.js"),
    NodePath.join(prefix, "lib/node_modules/zcode-acp-server/dist/index.js"),
  ].find((candidate) => NodeFS.existsSync(candidate));
  if (!entry) throw new Error("The selected prefix does not contain the ZCode ACP bridge.");
  return entry;
}

function bridgeEnvironment(state, extra = {}) {
  return {
    ...process.env,
    ZCODE_BIN: state.runtimePath,
    ZCODE_NODE: process.execPath,
    ZCODE_ACP_RUNTIME: "node",
    ...extra,
  };
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    if (process.platform === "win32") {
      NodeChildProcess.spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 10_000,
      });
    } else {
      child.kill();
    }
    await closed;
  } finally {
    clearTimeout(force);
  }
}

export async function probeBridge(prefix, state) {
  const entry = bridgeEntry(prefix);
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ksg-zcode-check-"));
  const child = NodeChildProcess.spawn(process.execPath, [entry], {
    cwd,
    env: bridgeEnvironment(state, {
      // Hide remote-access configuration during the probe so staging cannot restart a hub.
      XDG_CONFIG_HOME: NodePath.join(cwd, "config"),
      ZCODE_ACP_REMOTE: "0",
    }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let pending;
  let buffered = "";
  child.stdin.on("error", () =>
    pending?.reject(new Error("ACP compatibility probe input closed.")),
  );
  child.stderr.resume();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    if (buffered.length > 2 * 1024 * 1024) {
      pending?.reject(new Error("ACP probe output exceeded its size limit."));
      return;
    }
    let end;
    while ((end = buffered.indexOf("\n")) >= 0) {
      let message;
      try {
        message = JSON.parse(buffered.slice(0, end));
      } catch {
        buffered = buffered.slice(end + 1);
        continue;
      }
      buffered = buffered.slice(end + 1);
      if (message.id !== pending?.id) continue;
      if (message.error) pending.reject(new Error("ACP compatibility probe was rejected."));
      else pending.resolve(message.result);
    }
  });
  child.on("error", () => pending?.reject(new Error("ACP compatibility probe could not start.")));
  child.on("exit", () => pending?.reject(new Error("ACP compatibility probe exited early.")));
  const request = (id, method, params) =>
    new Promise((resolve, reject) => {
      pending = { id, resolve, reject };
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const timer = setTimeout(
    () => pending?.reject(new Error("ACP compatibility probe timed out.")),
    30_000,
  );
  try {
    const init = await request(1, "initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "ksg-zcode-updater", version: "1" },
    });
    const steering = init._meta?.["t3code/steering"];
    if (steering?.version !== 1 || !steering.idempotent || !steering.holdsPrompt)
      throw new Error("The bridge is missing KSG native steering support.");
    const session = await request(2, "session/new", { cwd, mcpServers: [] });
    const models =
      session.configOptions
        ?.find((option) => option.id === "model")
        ?.options.map((option) => option.value) ?? [];
    if (!models.length) throw new Error("ACP compatibility probe did not discover any models.");
    return models;
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    await stopChild(child);
    NodeFS.rmSync(cwd, { recursive: true, force: true });
  }
}

function findNpm() {
  const bin = NodePath.dirname(process.execPath);
  const adjacentNpm = NodePath.join(bin, "npm");
  const candidates = [
    NodePath.join(bin, "node_modules/npm/bin/npm-cli.js"),
    NodePath.resolve(bin, "../lib/node_modules/npm/bin/npm-cli.js"),
    ...(NodeFS.existsSync(adjacentNpm) && NodeFS.realpathSync(adjacentNpm).endsWith("/npm-cli.js")
      ? [NodeFS.realpathSync(adjacentNpm)]
      : []),
    "/usr/share/nodejs/npm/bin/npm-cli.js",
  ];
  const npm = candidates.find((candidate) => NodeFS.existsSync(candidate));
  if (!npm) throw new Error("Cannot locate npm for the configured Node installation.");
  return npm;
}

function installPackage(prefix, tarball) {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        findNpm(),
        "install",
        "--prefix",
        prefix,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        tarball,
      ],
      { stdio: "inherit" },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopChild(child);
    }, 8 * 60_000);
    child.on("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve();
      else
        reject(
          new Error(
            timedOut
              ? "KSG bridge package installation timed out."
              : "KSG bridge package installation failed.",
          ),
        );
    });
  });
}

function replaceState(file, state, previousBytes) {
  if (NodeFS.readFileSync(file, "utf8") !== previousBytes)
    throw new Error("ZCode installation changed during the update; nothing was activated.");
  const temporary = `${file}.${NodeCrypto.randomUUID()}.tmp`;
  try {
    NodeFS.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    NodeFS.renameSync(temporary, file);
  } finally {
    NodeFS.rmSync(temporary, { force: true });
  }
}

export async function updateInstallation(file, operations = {}) {
  const original = NodeFS.readFileSync(file, "utf8");
  const state = JSON.parse(original);
  const tag = await (operations.latest ?? latestRelease)();
  if (compareVersions(state.release, tag) >= 0) return false;
  const fetcher = operations.fetch ?? fetch;
  const base = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;
  const manifest = JSON.parse(
    (await download(`${base}/MANIFEST.json`, 1024 * 1024, fetcher)).toString("utf8"),
  );
  if (!/^zcode-acp-server-[\w.-]+\.tgz$/.test(manifest?.artifact?.tarball ?? ""))
    throw new Error("Invalid KSG bridge artifact name.");
  const bytes = await download(`${base}/${manifest.artifact.tarball}`, 32 * 1024 * 1024, fetcher);
  verifyArtifact(manifest, bytes, tag);
  const root = NodePath.join(NodePath.dirname(file), "versions");
  NodeFS.mkdirSync(root, { recursive: true });
  const staged = NodeFS.mkdtempSync(NodePath.join(root, `${releaseVersion(tag)}-`));
  const tarball = NodePath.join(staged, "bridge.tgz");
  NodeFS.writeFileSync(tarball, bytes);
  try {
    await (operations.install ?? installPackage)(staged, tarball);
    const probe = operations.probe ?? probeBridge;
    const before = await probe(state.prefix, state);
    const after = new Set(await probe(staged, state));
    if (before.some((model) => !after.has(model)))
      throw new Error(
        "The staged bridge is missing existing models; the current install was retained.",
      );
    replaceState(
      file,
      {
        ...state,
        prefix: staged,
        release: tag,
        previous: { prefix: state.prefix, release: state.release },
      },
      original,
    );
    return true;
  } catch (error) {
    NodeFS.rmSync(staged, { recursive: true, force: true });
    throw error;
  }
}

export async function adoptInstallation(args, home = NodeOS.homedir()) {
  const argument = (name) => {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (!value || value.startsWith("--")) throw new Error(`Missing required ${name} argument.`);
    return value;
  };
  const prefix = NodePath.resolve(argument("--adopt"));
  const release = argument("--release");
  releaseVersion(release);
  const runtimePath = NodePath.resolve(argument("--runtime"));
  if (!NodeFS.existsSync(runtimePath)) throw new Error("The existing ZCode runtime is missing.");
  bridgeEntry(prefix);
  findNpm();
  const root = NodePath.join(home, ".local/lib/ksg-providers/zcode-acp/managed");
  const file = NodePath.join(root, "state.json");
  if (NodeFS.existsSync(root))
    throw new Error("ZCode is already managed; the existing state was retained.");
  const settingsPath = NodePath.join(home, ".t3/userdata/settings.json");
  const original = NodeFS.readFileSync(settingsPath, "utf8");
  const settings = JSON.parse(original);
  const instance = settings.providerInstances?.zcode;
  if (!instance || instance.driver !== "zcode")
    throw new Error("No existing ZCode provider to adopt.");
  await probeBridge(prefix, { runtimePath });
  NodeFS.mkdirSync(NodePath.dirname(root), { recursive: true });
  NodeFS.mkdirSync(root);
  const launch = NodePath.join(root, "launch.mjs");
  const quoted = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const wrapper = NodePath.join(root, "zcode-acp");
  instance.config = {
    ...instance.config,
    binaryPath: process.platform === "win32" ? process.execPath : wrapper,
    launchArgs: process.platform === "win32" ? JSON.stringify(launch.replaceAll("\\", "/")) : "",
  };
  try {
    NodeFS.copyFileSync(
      settingsPath,
      NodePath.join(root, "settings.before.json"),
      NodeFS.constants.COPYFILE_EXCL,
    );
    NodeFS.copyFileSync(self, launch);
    NodeFS.writeFileSync(
      file,
      JSON.stringify({ schema: 1, prefix, release, runtimePath }, null, 2) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    if (process.platform !== "win32")
      NodeFS.writeFileSync(
        wrapper,
        `#!/bin/sh\nexec ${quoted(process.execPath)} ${quoted(launch)} "$@"\n`,
        { mode: 0o755 },
      );
    replaceState(settingsPath, settings, original);
  } catch (error) {
    NodeFS.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  console.log(
    `Managed KSG ZCode ${releaseVersion(release)}; existing bridge and credentials retained.`,
  );
}

export async function rollbackInstallation(file, probe = probeBridge) {
  const original = NodeFS.readFileSync(file, "utf8");
  const state = JSON.parse(original);
  if (!state.previous) throw new Error("No previous KSG bridge installation is available.");
  await probe(state.previous.prefix, state);
  replaceState(
    file,
    { ...state, ...state.previous, previous: { prefix: state.prefix, release: state.release } },
    original,
  );
}

async function main(args) {
  if (args.includes("--adopt")) return adoptInstallation(args);
  const state = JSON.parse(NodeFS.readFileSync(stateFile, "utf8"));
  if (args.includes("--ksg-maintenance"))
    return console.log(
      JSON.stringify({ schema: 1, repository, installedVersion: releaseVersion(state.release) }),
    );
  if (args.includes("--ksg-update-check"))
    return console.log(releaseVersion(await latestRelease()));
  if (args.includes("--ksg-update")) {
    const changed = await updateInstallation(stateFile);
    return console.log(changed ? "KSG ZCode updated and verified." : "KSG ZCode is current.");
  }
  if (args.includes("--ksg-rollback")) {
    await rollbackInstallation(stateFile);
    return console.log("Previous KSG ZCode installation restored.");
  }
  const entry = bridgeEntry(state.prefix);
  if (args.includes("--version"))
    return console.log(
      JSON.parse(
        NodeFS.readFileSync(NodePath.resolve(NodePath.dirname(entry), "../package.json"), "utf8"),
      ).version,
    );
  Object.assign(process.env, bridgeEnvironment(state));
  const { main: start } = await import(NodeURL.pathToFileURL(entry).href);
  await start();
}

if (process.argv[1] && NodeFS.realpathSync(process.argv[1]) === self)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
