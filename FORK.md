# KSG Code fork

KSG Code follows [T3 Code](https://github.com/pingdotgg/t3code), with its own
updates, branding, signing, and customizations. The CLI remains `t3`, state
remains in `~/.t3`, and the app ID remains `com.t3tools.t3code`. KSG and upstream
share state and must not run side by side.

The always-applicable rules live in [AGENTS.md](AGENTS.md#ksg-fork-rules).
The three long-lived branches are `upstream` (pristine nightly),
`ksg/passthrough` (distribution patches), and `ksg/dev` (default branch,
including customizations). Short-lived feature branches are also allowed.

## Syncing with upstream

Choose a published upstream release, not a tag from the fork's mixed tag list.
Settings → General → About shows the installed build's included upstream
nightly and offers a review link and merge prompt when a newer one exists.
Checking never merges, publishes, or installs anything.

These commands assume a single checkout. If a branch already has a worktree,
run its merge commands there instead of switching or force-moving it. Start
with clean worktrees. If any command fails, stop and resolve it before continuing.

```sh
git config rerere.enabled true
git fetch origin
git fetch --no-tags https://github.com/pingdotgg/t3code.git 'refs/tags/v*:refs/tags/upstream/v*'
tag="$(gh api 'repos/pingdotgg/t3code/releases?per_page=100' --jq '[.[] | select(.draft == false and .published_at != null and (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+-nightly\\.[0-9]{8}\\.[0-9]+$")))] | max_by(.published_at).tag_name')"
test -n "$tag" && test "$tag" != null
upstream_ref="refs/tags/upstream/$tag"
git rev-parse --verify "$upstream_ref^{commit}"

git switch upstream && git merge --ff-only origin/upstream && git merge --ff-only "$upstream_ref"
git switch ksg/passthrough && git merge --ff-only origin/ksg/passthrough && git merge --no-edit upstream
git switch ksg/dev && git merge --ff-only origin/ksg/dev && git merge --no-edit ksg/passthrough
vp i
```

Review the selected release and both merge layers. Inspect
`git diff upstream ksg/passthrough` for distribution patches and
`git diff ksg/passthrough ksg/dev` for customizations. Upstream wins outside
their intent. If code moved, reapply the intent where it moved; never drop a
patch to resolve a conflict. Run focused tests and affected package typechecks.
Branches move forward by merges, never rebases or force-pushes.

Only after approval, push `upstream`, `ksg/passthrough`, and `ksg/dev`.
Pushing `ksg/dev` publishes a release; it is not just a source backup.

## Versions and update feeds

Releases use `X.Y.Z-nightly.YYYYMMDD.N`. The base version and date come from
the included upstream nightly, and `N = upstream run * 100 + fork counter`,
where the counter is 1 through 99. Upstream `.3093` becomes fork `.309301`,
then `.309302` for a fork-only rebuild. Successive fork releases sort correctly;
do not compare the fork's larger run number directly with an upstream version.

The release workflow embeds the exact included upstream tag in the web bundle
as `VITE_KSG_UPSTREAM_TAG`. Settings compares that tag with upstream releases,
with the encoded fork version as a fallback for manual builds. Fork-only
rebuilds do not advance this baseline. Integrating and publishing a new nightly
advances it automatically, including multiple upstream nightlies on one day.
Unversioned development builds without metadata report an unknown baseline.

CLI archives and the release-availability check must use this fork's GitHub
releases, not npm. The desktop feed comes from `GITHUB_REPOSITORY` or
`T3CODE_DESKTOP_UPDATE_REPOSITORY` at build time. The sidebar updater updates
providers, connected servers, then the local desktop last. Upstream merge
checks must never replace the KSG installation with an upstream artifact.

## Releases and macOS signing

`.github/workflows/ksg-release.yml` publishes pushes to `ksg/dev`
(except Markdown-only pushes), or manual dispatches. It builds macOS arm64
and Linux x64 using upstream's reusable desktop workflow.

- Keep `KSG Release` and `Release desktop build` enabled in Actions. Other
  upstream workflows need upstream's runners and secrets and should stay disabled.
- Secrets `KSG_MACOS_P12` and `KSG_MACOS_P12_PASSWORD` must contain the existing
  signing identity. Never regenerate it for an ordinary release: installed apps
  reject an update signed by a different certificate.
- Keep certificates, private keys, `.p12` files, and signing keychains outside
  this repository. For a local build, prepare an external keychain with the
  existing identity, set `T3CODE_MACOS_SELF_SIGNED=true` and `CSC_KEYCHAIN`,
  and run `node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --signed`.
  Do not set `CSC_LINK` for this self-signed path.
- Optional `KSG_RELAY_URL` and `KSG_CLERK_*` repository variables enable T3
  Connect. Without them, it is omitted.
- If pushing workflows is denied, stop and ask the user to authorize the
  required GitHub workflow permission. Do not change authentication yourself.

Self-signed builds skip notarization and team-dependent passkey entitlements.
The first launch may require Finder's Open command. Later KSG updates must
satisfy the installed app's designated requirement, which pins the certificate.
Moving from Apple's upstream signing identity to KSG requires a manual
reinstall and may require privacy permissions and Keychain access again.

## Server cutover and launcher compatibility

The boot-service launcher stays pinned across self-updates. The running server,
not the launcher, downloads its replacement from its compiled release repository.

- The first hop from upstream to KSG needs the fork's `t3 update <version>`
  locally, or the service download override
  `T3CODE_RELEASE_BASE_URL=https://github.com/KldsSeeGhosts/ksgcode/releases/download`.
  After cutover, the KSG runtime uses this fork's feed.
- Replace upstream or npm-installed `t3` commands on `PATH` with the fork's
  archive, or local update and service commands will still use upstream.
- If upstream raises `SERVICE_LAUNCHER_PROTOCOL`, preflight blocks updates
  under an older launcher. Run `t3 service install` from the new fork binary
  locally to repin the service. Do not work around that safety check.
