import {
  type EnvironmentId,
  type UsageLimitSourceConfig,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SecretInput } from "./SecretInput";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

/**
 * Dots and dashes in the host are kept so `foo-bar.com` and `foo.bar.com` do
 * not collide; anything else (a port's colon, a path) is folded to a dash.
 */
function sourceIdFromUrl(url: string, kind: UsageLimitSourceConfig["kind"]): UsageLimitSourceId {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return UsageLimitSourceId.make(`${kind}-${slug || "hub"}`);
}

/**
 * The management key is sent once and kept in that server's secret store; settings only ever
 * carry a redaction marker for it afterwards.
 */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<UsageLimitSourceConfig["kind"]>("cpa-manager");
  const [url, setUrl] = useState("");
  const [managementKey, setManagementKey] = useState("");
  const trimmedUrl = url.trim();
  const canSave = trimmedUrl.length > 0 && managementKey.trim().length > 0;

  const reset = () => {
    setLabel("");
    setUrl("");
    setManagementKey("");
  };

  const save = () => {
    if (!canSave) return;
    const id = sourceIdFromUrl(trimmedUrl, kind);
    updateSettings({
      usageLimitSources: {
        [id]: {
          kind,
          ...(label.trim() ? { label: label.trim() } : {}),
          url: trimmedUrl,
          managementKey: managementKey.trim(),
          enabled: true,
        },
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a usage hub</DialogTitle>
          <DialogDescription>
            Show pooled account limits on {environmentLabel}. CPA Manager also lists every auth
            file, including disabled accounts. The key stays on that server.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-kind">Hub type</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  if (value) setKind(value);
                }}
              >
                <SelectTrigger id="usage-source-kind">
                  <SelectValue>
                    {kind === "cpa-manager" ? "CPA Manager" : "CLIProxyAPI"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="cpa-manager">CPA Manager</SelectItem>
                  <SelectItem value="cliproxy">CLIProxyAPI</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-url">Hub URL</Label>
              <Input
                id="usage-source-url"
                placeholder={
                  kind === "cpa-manager"
                    ? "https://hub.example.ts.net"
                    : "https://hub.example.ts.net:8318"
                }
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-key">
                {kind === "cpa-manager" ? "Manager admin key" : "Management key"}
              </Label>
              <SecretInput
                id="usage-source-key"
                value={managementKey}
                onChange={(event) => setManagementKey(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">Label (optional)</Label>
              <Input
                id="usage-source-label"
                placeholder="Defaults to the hub's host name"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            Add hub
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
