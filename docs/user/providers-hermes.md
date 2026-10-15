# Hermes

T3 Code runs [Hermes Agent](https://github.com/NousResearch/hermes-agent) through `hermes acp`,
keeping Hermes's configured model provider, tools, plugins, and sessions.

## Set up Hermes

1. Install Hermes Agent on the machine running the T3 Code server and configure a model with
   `hermes acp --setup`.
2. Open **Settings → Providers** and enable Hermes.

If `hermes` is not on the server's `PATH`, or you use a wrapper script, set its **Binary path**.
T3 Code adds the `acp` argument itself; **Launch arguments** follow it, for example
`--accept-hooks`.

## What carries over

Models, reasoning effort, and Hermes's session modes come from Hermes. Send `/compact`, or use
**Compact** from the context meter, to run Hermes's `/compress`. Send `/compress` yourself to pass
its options, such as a focus topic. The context meter follows Hermes's usage reports.

T3's permission mode selects Hermes's corresponding edit-approval mode, including when resuming
a session. Hermes's current ACP interface does not expose its native `clarify` question tool;
ordinary chat questions still work.

## Updates

For source installations that support `hermes update --plan`, **Settings → Providers** can run
`hermes update --yes` through the configured executable, including wrappers. Hermes handles its
own backups, dependency preparation, configuration migration, and service restarts. Finish active
Hermes work first. Desktop-bundled and package-managed installs remain managed outside T3 Code.
Source-branch checks may not report a comparable release version; the native update action is
still available when the latest version is unknown.
