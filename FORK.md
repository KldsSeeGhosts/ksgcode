# KSG Code fork

KSG Code is upstream [T3 Code](https://github.com/pingdotgg/t3code) plus the
smallest set of patches that let it build for macOS arm64 and Linux x64 and
update from this repository's releases. Everything else follows upstream:
the `t3` CLI, `~/.t3`, the `T3CODE_*` variables, the `t3code://` scheme, the
desktop app ID `com.t3tools.t3code`, and the Electron profile folder are
unchanged, so KSG Code and T3 Code share state and cannot run side by side.

## Branches

This repository has exactly three branches.

- `upstream` is upstream's code at the nightly tag the fork is based on. It
  only ever fast-forwards to a newer upstream nightly tag; nothing is
  committed to it.
- `ksg/passthrough` is `upstream` plus exactly the patches below (and this
  file). `git diff upstream ksg/passthrough` is the complete patch set.
- `ksg/dev` is the default branch: `ksg/passthrough` plus the fork's own
  customizations. Clone it, work on short-lived branches off it, and merge
  them back. The release workflow builds it.

Branches only move forward by merges, never by rebase or force-push, so every
machine can always `git pull`. Do not use GitHub's "Sync fork" button: it
merges upstream's `main`, not a nightly tag, into `ksg/dev`.

## Syncing with upstream

Run this when upstream publishes a new nightly, or ask an agent to "sync KSG
Code with the latest upstream nightly per FORK.md". Conflicts are resolved
once per layer: patches in `ksg/passthrough`, customizations in `ksg/dev`.

```sh
git remote add t3code https://github.com/pingdotgg/t3code.git  # once per clone
git config rerere.enabled true                                 # once per clone
git fetch origin && git fetch t3code --tags
tag="$(git tag -l 'v*-nightly.*' --sort=-v:refname | head -1)"

git switch upstream && git merge --ff-only origin/upstream && git merge --ff-only "$tag"
git switch ksg/passthrough && git merge --ff-only origin/ksg/passthrough && git merge --no-edit upstream
git switch ksg/dev && git merge --ff-only origin/ksg/dev && git merge --no-edit ksg/passthrough
vp i
git push origin upstream ksg/passthrough ksg/dev
```

Rules for resolving conflicts, for people and agents:

- Upstream wins everywhere except the intent of a patch in the table below or
  a customization on `ksg/dev`. Re-apply that intent to upstream's new code
  rather than restoring the old lines.
- Never drop a patch to make a conflict go away. If upstream removed the code
  a patch changed, find where the behavior moved; if it is gone, update the
  table and say so in the merge commit.
- After each merge, typecheck the affected packages and run the tests for the
  files the conflicts touched (`vp test run <files>`; see AGENTS.md). Do not
  run repo-wide checks.
- Push only when both merges are clean and checked. Pushing `ksg/dev` is what
  publishes a release once the release workflow is enabled.

## Branches

- `fork/main` mirrors the upstream nightly tag the fork is currently based on.
- `ksg/passthrough` is that base plus exactly the patches below, nothing
  else. It is rebased onto each new upstream tag and carries no other work.
- `ksg/dev` is `ksg/passthrough` plus the fork's own customizations. Everyday
  work happens on short-lived branches merged into it, and it is what the
  release workflow should build; point its trigger at `ksg/dev`.

## Patches

| What                                                                                                       | Why                                                                                                                                                                 | File                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CLI_RELEASE_REPOSITORY` is `KldsSeeGhosts/ksgcode`, plus `cliReleaseByTagUrl`                             | `t3 update`, `t3 service install`, and server self-update download CLI archives from this repository                                                                | `packages/shared/src/cliRelease.ts` (and its test)                                                          |
| The update gate asks GitHub whether `v<version>` is released here instead of asking npm for `t3@<version>` | Remote servers install the CLI archive from this repository's release; the fork does not publish to npm. The file keeps its upstream name to avoid rename conflicts | `apps/web/src/state/npmRelease.ts` (and its test), `apps/web/src/components/sidebar/useUpdateEverything.ts` |
| Product name is `KSG Code` on every channel; artifacts are `KSG-Code-${version}-${arch}.${ext}`            | Branding of the bundle, installer, and release assets. Upstream forces `T3 Code (Nightly)` for nightly versions                                                     | `scripts/build-desktop-artifact.ts` (and its test)                                                          |
| `T3CODE_MACOS_SELF_SIGNED=true` with `--signed` signs with a self-signed certificate                       | No Apple Developer account: no team ID, provisioning profile, or notarization                                                                                       | `scripts/build-desktop-artifact.ts`, `scripts/sign-macos.ts`                                                |
| A pointer to this file at the top of `AGENTS.md`                                                           | Agents working in the fork read the patch list and sync rules first                                                                                                 | `AGENTS.md`                                                                                                 |

Not patched, on purpose: the desktop update feed already comes from
`GITHUB_REPOSITORY` (or `T3CODE_DESKTOP_UPDATE_REPOSITORY`) at build time, so a
build in this repository's Actions points at this repository. Links to
upstream release notes, the model manifest, and the Android APK still point
upstream.

## Versions

Releases keep upstream's shape, `X.Y.Z-nightly.YYYYMMDD.N`, with no `+build`
suffix. `X.Y.Z` and `YYYYMMDD` come from the upstream tag the build is based
on, and `N = upstream run number * 100 + fork counter`, with the counter
starting at 1 for each upstream tag. Upstream `v0.0.46-nightly.20261014.3093`
becomes `v0.0.46-nightly.20261014.309301`, then `.309302` for a fork-only
rebuild. Every fork version sorts above the upstream nightly it is based on
and below the next one, so electron-updater, `t3 update`, and the service
launcher order them correctly. The counter must stay below 100.

`scripts/resolve-nightly-release.ts` already takes `--date` and `--run-number`,
so the release workflow passes the computed values and no script changes.

## Self-signed macOS signing

electron-builder only accepts trusted identities and its own `.p12` import
(`CSC_LINK`) fails on current macOS, so the self-signed path uses a keychain
you prepare. Create the certificate once and keep the `.p12` safe: updates
only install when the new build is signed by the same certificate.

```sh
cat > cert.cnf <<'EOF'
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=KSG Code Self-Signed
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config cert.cnf -keyout key.pem -out cert.pem
openssl pkcs12 -export -legacy -inkey key.pem -in cert.pem -name "KSG Code Self-Signed" -out ksg.p12
```

Build:

```sh
keychain="$PWD/ksg-signing.keychain-db"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import ksg.p12 -k "$keychain" -P "$p12_password" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null

T3CODE_MACOS_SELF_SIGNED=true CSC_KEYCHAIN="$keychain" \
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --signed
```

Do not set `CSC_LINK` for this path. The build skips the passkey entitlements
(they need a team ID), so in-app browser passkeys are unavailable, and skips
notarization. Gatekeeper blocks the first launch of a downloaded DMG; open it
once with Finder's Open command or `xattr -dr com.apple.quarantine`. Updates
after that install without prompts.

Squirrel.Mac installs an update only when it satisfies the running app's
designated requirement, which for this certificate is `identifier
"com.t3tools.t3code" and certificate leaf = H"<sha1>"`. Updates between KSG
builds signed with the same certificate install; a different certificate is
rejected. macOS privacy grants (TCC) are checked against the same
requirement, so they should carry across those updates; this has not been
observed, since granting needs the GUI.

Moving from T3 Code to KSG Code is a manual reinstall, not an update: T3
Code's requirement pins Apple's anchor and team `ARK85ZXQ4Z`, so its updater
rejects KSG builds. Expect to re-grant macOS privacy permissions once, and a
one-time Keychain prompt for `t3code Safe Storage`, which T3 Code created.

## Release workflow (draft)

The token used to push this repository lacks the `workflow` scope, so the
workflow lives here until someone with that scope adds it as
`.github/workflows/ksg-release.yml`. It replaces upstream's `release.yml` for
this repository; disable upstream's scheduled workflows in the repository
settings (they need upstream's runners and secrets).

Secrets: `KSG_MACOS_P12` (base64 `.p12`), `KSG_MACOS_P12_PASSWORD`.

```yaml
name: KSG Release

on:
  workflow_dispatch:
  push:
    branches: [ksg/dev]

concurrency:
  group: ksg-release
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  preflight:
    runs-on: ubuntu-24.04
    outputs:
      version: ${{ steps.version.outputs.version }}
      tag: ${{ steps.version.outputs.tag }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Fetch upstream nightly tags
        run: git fetch --no-tags https://github.com/pingdotgg/t3code.git 'refs/tags/v*-nightly.*:refs/tags/upstream/v*-nightly.*'
      - id: version
        name: Resolve fork version
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          upstream="$(git describe --tags --abbrev=0 --match 'upstream/v*-nightly.*' HEAD)"
          upstream="${upstream#upstream/v}"
          if [[ ! "$upstream" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-nightly\.([0-9]{8})\.([0-9]+)$ ]]; then
            echo "Unexpected upstream tag: $upstream" >&2; exit 1
          fi
          base="${BASH_REMATCH[1]}"; date="${BASH_REMATCH[2]}"; run="${BASH_REMATCH[3]}"
          prefix="v${base}-nightly.${date}."
          used="$(gh release list --limit 200 --json tagName --jq '.[].tagName' \
            | awk -v p="$prefix" -v r="$run" 'index($0, p) == 1 { n = substr($0, length(p) + 1); if (int(n / 100) == r) print n % 100 }' \
            | sort -n | tail -1)"
          counter=$(( ${used:-0} + 1 ))
          if (( counter > 99 )); then echo "Fork counter exhausted for $upstream" >&2; exit 1; fi
          version="${base}-nightly.${date}.$(( run * 100 + counter ))"
          echo "version=$version" >> "$GITHUB_OUTPUT"
          echo "tag=v$version" >> "$GITHUB_OUTPUT"

  build:
    needs: preflight
    strategy:
      fail-fast: true
      matrix:
        include:
          - { runner: macos-15, platform: mac, target: dmg, arch: arm64, cli: darwin-arm64 }
          - { runner: ubuntu-24.04, platform: linux, target: AppImage, arch: x64, cli: linux-x64 }
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@v6
      - uses: voidzero-dev/setup-vp@v1
        with:
          node-version-file: package.json
          cache: true
          run-install: true
      - uses: dtolnay/rust-toolchain@stable
      - name: Linux packaging tools
        if: matrix.platform == 'linux'
        run: sudo apt-get update && sudo apt-get install -y rpm fakeroot dpkg
      - name: Import self-signed certificate
        if: matrix.platform == 'mac'
        env:
          P12: ${{ secrets.KSG_MACOS_P12 }}
          P12_PASSWORD: ${{ secrets.KSG_MACOS_P12_PASSWORD }}
        run: |
          keychain="$RUNNER_TEMP/ksg-signing.keychain-db"
          keychain_password="$(openssl rand -hex 16)"
          printf '%s' "$P12" | base64 --decode > "$RUNNER_TEMP/ksg.p12"
          security create-keychain -p "$keychain_password" "$keychain"
          security set-keychain-settings -lut 21600 "$keychain"
          security unlock-keychain -p "$keychain_password" "$keychain"
          security import "$RUNNER_TEMP/ksg.p12" -k "$keychain" -P "$P12_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
          rm "$RUNNER_TEMP/ksg.p12"
          echo "CSC_KEYCHAIN=$keychain" >> "$GITHUB_ENV"
          echo "T3CODE_MACOS_SELF_SIGNED=true" >> "$GITHUB_ENV"
      - name: Build desktop app
        env:
          T3CODE_DESKTOP_UPDATE_REPOSITORY: ${{ github.repository }}
        run: |
          node scripts/build-desktop-artifact.ts \
            --platform ${{ matrix.platform }} --target ${{ matrix.target }} --arch ${{ matrix.arch }} \
            --build-version ${{ needs.preflight.outputs.version }} \
            ${{ matrix.platform == 'mac' && '--signed' || '' }} \
            --output-dir release
      - name: Build CLI archive
        # Same invocation as upstream's release-desktop.yml cli_archive step;
        # copy it from there when rebasing, it changes with upstream.
        run: node scripts/build-cli-archive.ts --version ${{ needs.preflight.outputs.version }} --platform-key ${{ matrix.cli }} --output-dir release
      - uses: actions/upload-artifact@v7
        with:
          name: release-${{ matrix.cli }}
          path: release/*
          if-no-files-found: error

  release:
    needs: [preflight, build]
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v6
      - uses: actions/download-artifact@v8
        with:
          pattern: release-*
          merge-multiple: true
          path: release
      - name: Checksums
        working-directory: release
        run: sha256sum t3-*.tar.gz > SHA256SUMS
      - name: Publish
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${{ needs.preflight.outputs.tag }}" release/* \
            --target "$GITHUB_SHA" --prerelease \
            --title "KSG Code ${{ needs.preflight.outputs.version }}" \
            --notes "Upstream T3 Code with the patches in FORK.md."
```

Check the CLI archive step and the manifest names (`nightly-mac.yml`,
`nightly-linux.yml`) against upstream's `release-desktop.yml` and the
`release` job in `release.yml` before enabling it; upstream merges per-arch
manifests with `scripts/merge-update-manifests.ts`, which a single arch per
platform does not need.

## Server cutover

A boot-service server runs `<T3 home>/runtime/versions/<v>/t3 __service-launcher`,
pinned when `t3 service install` ran. The launcher never downloads anything:
the running server downloads the next runtime with the release repository
compiled into it, then asks the launcher to switch. So:

- The first hop from an upstream runtime to a KSG version cannot use remote
  update: the upstream runtime looks for the version on `pingdotgg/t3code`.
  Either run the fork's `t3 update <ksg version>` once on the server, or set
  `T3CODE_RELEASE_BASE_URL=https://github.com/KldsSeeGhosts/ksgcode/releases/download`
  in the service environment before updating remotely.
- After that hop the server downloads from this repository.
- The launcher stays the originally installed binary across self-updates. It
  does not need replacing while it speaks the same launcher protocol
  (`SERVICE_LAUNCHER_PROTOCOL` in `apps/server/src/cloud/serviceProtocol.ts`):
  stable v0.0.43 to v0.0.45 and this base all use protocol 3. When upstream
  bumps it, the staged runtime's preflight blocks the update, and running
  `t3 service install` from the new binary repins the unit.
- Replace any `t3` on `PATH` from npm or the upstream installer with the
  fork's archive, or `t3 update` and `t3 service install` keep reading
  upstream releases.
