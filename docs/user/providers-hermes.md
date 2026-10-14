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
