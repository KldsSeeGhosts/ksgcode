import {
  compareForkUpstream,
  T3_UPSTREAM_REPOSITORY,
  upstreamMergePrompt,
  upstreamReviewUrl,
} from "@t3tools/shared/forkUpstream";
import { CircleArrowUpIcon } from "lucide-react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "~/state/query";
import { includedUpstreamVersion, upstreamNightlyAtom } from "~/state/upstreamNightly";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Upstream changes are reviewed and merged into KSG, never installed over it. */
export function UpstreamNightlySettings() {
  const query = useEnvironmentQuery(upstreamNightlyAtom);
  const latest = query.data;
  const status =
    latest === null ? null : compareForkUpstream(includedUpstreamVersion, latest.version);
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

  const isBehind = status === "behind" && latest !== null && !query.error;
  const lastCheckedTooltip = latest
    ? `Last checked ${new Date(latest.checkedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : null;
  const refreshTooltip = lastCheckedTooltip
    ? `Check upstream · ${lastCheckedTooltip}`
    : "Check upstream";

  return (
    <SettingsRow
      id={searchableSetting("upstream-nightly").id}
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>Upstream</span>
          {includedUpstreamVersion ? (
            <code className="text-2xs font-medium text-muted-foreground">
              {includedUpstreamVersion}
            </code>
          ) : null}
          {isBehind ? (
            <Badge size="sm" variant="info">
              <CircleArrowUpIcon />
              Update available
            </Badge>
          ) : null}
        </span>
      }
      description={
        <span aria-live="polite">
          {query.error ? (
            `Could not check upstream. ${query.error}`
          ) : !latest ? (
            `Checking ${T3_UPSTREAM_REPOSITORY}…`
          ) : status === "behind" ? (
            <>
              <code className="text-2xs font-medium text-foreground">{latest.version}</code> is
              ready to review and merge.
            </>
          ) : status === "current" ? (
            `Up to date with ${T3_UPSTREAM_REPOSITORY}.`
          ) : (
            <>
              Latest nightly:{" "}
              <code className="text-2xs font-medium text-foreground">{latest.version}</code>.
            </>
          )}
        </span>
      }
      control={
        <div className="flex flex-wrap items-center gap-2">
          {isBehind ? (
            <>
              <Button
                render={
                  <a
                    href={upstreamReviewUrl(includedUpstreamVersion, latest.version)}
                    target="_blank"
                    rel="noreferrer noopener"
                  />
                }
                size="sm"
                variant="outline"
              >
                Review changes
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(upstreamMergePrompt(latest.version), undefined)}
              >
                {isCopied ? "Copied" : "Copy merge prompt"}
              </Button>
            </>
          ) : latest && !query.error ? (
            <Button
              render={
                <a
                  href={upstreamReviewUrl(includedUpstreamVersion, latest.version)}
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
              size="sm"
              variant="outline"
            >
              View upstream
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                isBehind ? (
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={query.isPending ? "Checking upstream…" : "Check upstream"}
                    disabled={query.isPending}
                    onClick={query.refresh}
                  >
                    <RefreshIcon refreshing={query.isPending} />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={query.isPending}
                    onClick={query.refresh}
                  >
                    {query.isPending ? "Checking…" : "Check upstream"}
                  </Button>
                )
              }
            />
            {isBehind || lastCheckedTooltip ? (
              <TooltipPopup side="top">
                {isBehind ? refreshTooltip : lastCheckedTooltip}
              </TooltipPopup>
            ) : null}
          </Tooltip>
        </div>
      }
    />
  );
}
