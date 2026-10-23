# DeepSeek Harness

KSG Code runs [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) through its
ACP profile, keeping Harness's models, tools, plugins, and credentials in its own home.

## Set up DeepSeek Harness

1. Install Harness on the machine hosting your KSG environment:
   `npm install -g @deepseek-ai/dsh`.
2. Configure the model provider in Harness's **acp** profile.
3. Open **Settings → Providers** and enable **DeepSeek Harness**, then refresh it.

If `dsh` is not on the environment's `PATH`, set **Binary path**. KSG adds `--profile acp`
automatically. **Launch arguments** can supply additional Harness options such as `--patch`.
Set `DSH_HOME` in the provider instance's environment overrides to use a separate Harness home.

Models and reasoning levels come from Harness, including custom gateways. KSG does not sign in
to DeepSeek on your behalf; API credentials remain in Harness's credential store or the provider
instance's sensitive environment variables.

## Use a CPA gateway

Configure a custom model API in `$DSH_HOME/profiles/acp/cordis.patch.yml`. The endpoint must be
reachable from the environment running Harness. For an existing CPA SSH tunnel, for example:

```yaml
- id: llm-pi-ai
  config:
    providers:
      cpa:
        api: openai-completions
        baseURL: http://127.0.0.1:8317/v1
        apiKeyEnv: CPA_API_KEY
        models:
          - id: opencode-go/deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash (CPA)
            contextWindow: 1000000
            maxTokens: 393216
            input: [text, image]
            compat:
              thinkingFormat: deepseek
            reasoningEfforts:
              off:
              low: low
              high: high
              max: max

- id: acp
  config:
    provider: cpa
    model: opencode-go/deepseek-v4.1-flash
```

Set `CPA_API_KEY` as a sensitive environment variable on the KSG provider instance, or resolve it
through Harness's credential store. Use the exact model ID your CPA endpoint advertises. If the
patch already configures `llm-pi-ai`, preserve its other providers: a Harness patch replaces that
plugin's complete configuration.

Changes made in Harness's Web UI normally belong to its **web** profile. Configure **acp**
explicitly, then refresh the provider so KSG discovers the new model options.

## Supported behavior

Conversations support multiple turns, cancellation, native session resume, MCP tools, model and
reasoning selection, and the context meter. Harness runs its tools under its own policy; KSG
shows **Supervised** and forwards the approval requests Harness sends. Harness persists that
policy in each native session, so changing its defaults does not change an existing session.

Use **Compact** from the context meter, or send `/compact`, to run Harness's native compaction
without replacing the session. The context meter refreshes when it finishes, and the condensed
history remains available when you resume the conversation. Stop cancels an active compaction.
If the session has no compactable history, KSG reports that instead of claiming it compacted.
This requires Harness's standard ACP profile with its compaction backend enabled.

Harness's ACP profile does not expose native plan cards, other slash commands,
conversation forks, or transcript replay. KSG uses portable context for forks and starts a fresh
native conversation after checkpoint rollback. App-owned title and commit-message generation
requires another provider.

Package-managed installations use the detected package manager for updates. Custom launchers
and desktop-owned installations remain manual.
