import {
  compareForkUpstream,
  resolveForkUpstreamVersion,
  upstreamMergePrompt,
  upstreamReviewUrl,
} from "@t3tools/shared/forkUpstream";

import { APP_VERSION } from "~/branding";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "~/state/query";
import { upstreamNightlyAtom } from "~/state/upstreamNightly";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const includedVersion = resolveForkUpstreamVersion(
  APP_VERSION,
  import.meta.env.VITE_KSG_UPSTREAM_TAG,
);

/** Upstream changes are reviewed and merged into KSG, never installed over it. */
export function UpstreamNightlySettings() {
  const query = useEnvironmentQuery(upstreamNightlyAtom);
  const latest = query.data;
  const status = latest === null ? null : compareForkUpstream(includedVersion, latest.version);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "upstream merge prompt",
    onError: (error) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy merge prompt",
          description: error.message,
        }),
      ),
  });

  return (
    <SettingsRow
      {...searchableSetting("upstream-nightly")}
      description={
        <span className="flex flex-col gap-1 break-words" aria-live="polite">
          <span>
            {includedVersion
              ? `Included upstream: ${includedVersion}.`
              : "This development build has no recorded upstream baseline."}
          </span>
          {query.error ? (
            <span>Could not check upstream. {query.error}</span>
          ) : latest ? (
            <span>
              {status === "behind"
                ? `New upstream nightly: ${latest.version}. Review its changes before merging.`
                : status === "current"
                  ? `No newer upstream nightly. Latest published: ${latest.version}.`
                  : `Latest upstream: ${latest.version}. Its merge status is unknown.`}
            </span>
          ) : (
            <span>Checking published upstream nightlies…</span>
          )}
          <span>
            Checks when opened and hourly while this page is open.
            {latest ? ` Last checked ${new Date(latest.checkedAt).toLocaleString()}.` : ""}
          </span>
        </span>
      }
      control={
        <Button size="sm" variant="outline" disabled={query.isPending} onClick={query.refresh}>
          {query.isPending ? "Checking upstream…" : "Check upstream"}
        </Button>
      }
    >
      {latest && !query.error ? (
        <div className="flex flex-wrap items-center gap-2 pt-3 pb-2">
          <Button
            render={
              <a
                href={upstreamReviewUrl(includedVersion, latest.version)}
                target="_blank"
                rel="noreferrer noopener"
              />
            }
            size="sm"
            variant="outline"
          >
            {status === "behind" ? "Review changes" : "View upstream"}
          </Button>
          {status === "behind" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(upstreamMergePrompt(latest.version), undefined)}
            >
              {isCopied ? "Copied" : "Copy merge prompt"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </SettingsRow>
  );
}
