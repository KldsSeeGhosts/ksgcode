import {
  IsoDateTime,
  ProviderDriverKind,
  TrimmedNonEmptyString,
  type ServerProviderUsageWindow,
  type UsageLimitSourceAccount,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";

const SummaryError = Schema.NullOr(Schema.Struct({ code: Schema.String }));
const SummaryAccount = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: Schema.String,
  synthetic: Schema.optional(Schema.Boolean),
  plan: Schema.optional(Schema.String),
  status: Schema.String,
  error: SummaryError,
  windows: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        label: Schema.String,
        usedPercent: Schema.NullOr(Schema.Number),
        remainingPercent: Schema.NullOr(Schema.Number),
        resetAt: Schema.String,
        estimated: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
});

export const CpaQuotaSummary = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  refreshedAt: Schema.Union([IsoDateTime, Schema.Literal("")]),
  status: Schema.String,
  error: SummaryError,
  providers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      accounts: Schema.Array(SummaryAccount),
    }),
  ),
});

// Only inventory metadata is decoded; raw auth-file payloads are never published to clients.
export const CpaAuthFiles = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      file_name: Schema.optional(Schema.String),
      fileName: Schema.optional(Schema.String),
      auth_index: Schema.optional(Schema.String),
      authIndex: Schema.optional(Schema.String),
      "auth-index": Schema.optional(Schema.String),
      provider: Schema.optional(Schema.String),
      type: Schema.optional(Schema.String),
      account: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
      display_account: Schema.optional(Schema.String),
      displayAccount: Schema.optional(Schema.String),
      disabled: Schema.optional(Schema.Boolean),
      status: Schema.optional(Schema.String),
      state: Schema.optional(Schema.String),
      account_id: Schema.optional(Schema.String),
      accountId: Schema.optional(Schema.String),
      chatgpt_account_id: Schema.optional(Schema.String),
      id_token: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            chatgpt_account_id: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
});

type AuthFile = (typeof CpaAuthFiles.Type.files)[number];
type SummaryWindow = NonNullable<typeof SummaryAccount.Type.windows>[number];
const first = (...values: ReadonlyArray<string | undefined>) =>
  values.find((value) => value?.trim())?.trim() ?? "";
const fileName = (file: AuthFile) => first(file.name, file.file_name, file.fileName, file.id);
const decodeDriver = Schema.decodeOption(ProviderDriverKind);

function providerId(value: string): string {
  const id = value.trim().toLowerCase().replaceAll("_", "-");
  if (id === "grok" || id === "x-ai") return "xai";
  if (
    [
      "llama",
      "meta-llama",
      "llama-api",
      "openai-compatible-meta",
      "openai-compatible-llama",
    ].includes(id)
  )
    return "meta";
  return id;
}

function driverFor(provider: string) {
  const id = provider === "claude" ? "claudeAgent" : provider === "xai" ? "grok" : provider;
  return decodeDriver(id).pipe(Option.getOrElse(() => ProviderDriverKind.make("cpa-unknown")));
}

const errorMessage = (code: string | undefined) => {
  switch (code) {
    case "unauthorized":
      return "Account authorization needs attention in CPA.";
    case "rate_limited":
      return "The provider rate-limited the quota read.";
    case "timeout":
      return "The provider did not answer the quota request.";
    case "not_found":
      return "The provider could not find this account.";
    case "parse_failed":
      return "CPA could not interpret the provider's quota response.";
    case "not_configured":
    case "setup_required":
      return "Quota reporting is not configured in CPA.";
    case "no_accounts":
      return "CPA reported no quota accounts.";
    default:
      return "CPA could not read this account's quota.";
  }
};

function windowFromSummary(
  provider: string,
  window: SummaryWindow,
): ServerProviderUsageWindow | null {
  const used =
    window.usedPercent ?? (window.remainingPercent === null ? null : 100 - window.remainingPercent);
  if (used === null || !Number.isFinite(used) || !window.id.trim()) return null;
  const id =
    provider === "claude"
      ? window.id.replaceAll("-", "_")
      : provider === "cursor"
        ? ({ auto: "autoPercentUsed", api: "apiPercentUsed", monthly: "totalPercentUsed" }[
            window.id
          ] ?? window.id)
        : window.id;
  const kind = /monthly|month|^(auto|api)$/.test(window.id)
    ? "monthly"
    : /weekly|seven[-_]day/.test(window.id)
      ? "weekly"
      : /five[-_]hour|session/.test(window.id)
        ? "session"
        : "other";
  const reset = DateTime.make(window.resetAt);
  const duration =
    window.id === "five-hour"
      ? 300
      : window.id === "weekly" || window.id === "seven-day" || window.id.startsWith("seven-day-")
        ? 10080
        : undefined;
  return {
    id,
    label: window.label.trim() || window.id,
    kind,
    usedPercent: Math.max(0, Math.min(100, used)),
    ...(Option.isSome(reset) ? { resetsAt: DateTime.formatIso(reset.value) } : {}),
    ...(duration ? { windowDurationMins: duration } : {}),
    ...(window.estimated ? { estimated: true } : {}),
  };
}

export const cpaSummaryToAccounts = Effect.fn("cpaSummaryToAccounts")(function* (
  summary: typeof CpaQuotaSummary.Type,
  files: typeof CpaAuthFiles.Type.files,
) {
  const crypto = yield* Crypto.Crypto;
  const checkedAt = summary.refreshedAt || DateTime.formatIso(yield* DateTime.now);
  const inventory = yield* Effect.forEach(files, (file) =>
    Effect.gen(function* () {
      // This is CPA Manager's schema-1 opaqueAccountID, not a credential fingerprint.
      const identity = [
        first(file.auth_index, file.authIndex, file["auth-index"]),
        fileName(file),
        first(file.account, file.email, file.display_account, file.displayAccount),
      ].join("|");
      const digest = yield* crypto
        .digest("SHA-256", new TextEncoder().encode(identity))
        .pipe(Effect.orDie);
      return { id: `acct_${Hex.encode(digest).slice(0, 16)}`, file };
    }),
  );
  const byId = new Map(inventory.map((item) => [item.id, item.file]));
  const matched = new Set<string>();
  const accounts: UsageLimitSourceAccount[] = [];
  const makeAccount = (
    provider: string,
    providerLabel: string,
    id: string,
    account?: typeof SummaryAccount.Type,
    file?: AuthFile,
  ): UsageLimitSourceAccount => {
    const windows = (account?.windows ?? []).flatMap((window) => {
      const mapped = windowFromSummary(provider, window);
      return mapped ? [mapped] : [];
    });
    const name = file ? fileName(file) : "";
    const email = file?.email?.trim();
    const workspaceId = first(
      file?.account_id,
      file?.accountId,
      file?.chatgpt_account_id,
      file?.id_token?.chatgpt_account_id,
    );
    const disabled =
      file?.disabled ??
      ["disabled", "inactive"].includes(first(file?.status, file?.state).toLowerCase());
    const failed = account?.status === "error" || account?.status === "unavailable";
    // The summary includes disabled files but omits their routing state. Without an inventory
    // match we can display the quota, but cannot safely count it as usable pooled capacity.
    const metadataMissing = account !== undefined && !file && !account.synthetic;
    return {
      id,
      driver: driverFor(provider),
      label: first(email, name, account?.label, id),
      providerLabel: first(providerLabel, provider) || "Unknown provider",
      ...(name ? { fileName: name } : {}),
      ...(email ? { email } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(account?.synthetic ? { synthetic: true } : {}),
      ...(account?.error && !failed
        ? { notice: `Showing cached quota. ${errorMessage(account.error.code)}` }
        : {}),
      ...(account?.plan?.trim() ? { plan: account.plan.trim() } : {}),
      usageLimits: {
        checkedAt,
        windows,
        ...(failed || windows.length === 0 || metadataMissing
          ? {
              unavailable: {
                reason:
                  account || summary.error ? ("probeFailed" as const) : ("unsupported" as const),
                message:
                  metadataMissing && !failed && windows.length > 0
                    ? "Auth-file status is unavailable; this account is not included in pooled limits."
                    : account || summary.error
                      ? errorMessage(account?.error?.code ?? summary.error?.code)
                      : "CPA does not report quota for this auth file.",
              },
            }
          : {}),
      },
    };
  };
  for (const provider of summary.providers) {
    const id = providerId(provider.id);
    for (const account of provider.accounts) {
      const file = byId.get(account.id);
      if (file) matched.add(account.id);
      accounts.push(makeAccount(id, provider.label, account.id, account, file));
    }
  }
  for (const { id, file } of inventory) {
    if (matched.has(id)) continue;
    const provider = providerId(first(file.provider, file.type));
    accounts.push(makeAccount(provider, provider, id, undefined, file));
  }
  return {
    accounts,
    ...(summary.status === "stale" ? { stale: true } : {}),
    ...(summary.error ? { error: errorMessage(summary.error.code) } : {}),
  };
});
