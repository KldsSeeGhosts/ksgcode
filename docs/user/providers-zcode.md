# ZCode

T3 Code runs [ZCode](https://z.ai) through its ACP bridge, keeping ZCode's GLM models, tools,
modes, and saved sign-in.

## Set up ZCode

1. Install the ZCode CLI or desktop app on the machine running the T3 Code server and sign in.
2. Install the ACP bridge with `npm install -g zcode-acp-server`, which provides `zcode-acp`.
3. Open **Settings → Providers** and enable ZCode.

If the bridge is not on the server's `PATH`, or you use a wrapper around it, set its
**Binary path**. **Launch arguments** are passed to the bridge on every session start.

## What carries over

Models, the **Thinking** level, and ZCode's own permission modes come from the bridge. Send
`/compact`, or use **Compact** from the context meter, to compact ZCode's conversation; the
context meter follows ZCode's usage reports. ZCode's other slash commands appear in the composer.

T3's permission mode selects ZCode's corresponding native mode rather than inheriting the
bridge's default. Structured questions show each question once, with suggested choices or a
custom answer; multi-select questions retain their multiple-choice behavior.

## Updates

Managed KSG installations use the same provider update action and **Update All** flow as other
providers. They check only published `KldsSeeGhosts/zcode-acp` releases, not the public npm bridge.
The updater verifies the download, native steering support, and existing model availability before
switching installations. If validation fails, the current bridge stays active. Existing sessions
are not restarted.

For ordinary global `zcode-acp-server` installations, updates use the detected package manager.
Other custom wrappers remain manual. Neither path updates the ZCode desktop app or changes sign-in.
