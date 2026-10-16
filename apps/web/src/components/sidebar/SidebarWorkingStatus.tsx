import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";

import styles from "./SidebarWorkingStatus.module.css";

/** Keep one accessible label while the timeline's highlight sweeps over stationary text. */
export function SidebarWorkingStatus({ label }: { label: string }) {
  return (
    <span
      ref={observeVisibleAnimation}
      role="status"
      className="relative inline-flex overflow-hidden"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>{label}</span>
      <span
        aria-hidden
        className={cn(
          "live-activity-focus pointer-events-none absolute inset-y-0 select-none",
          styles.shimmer,
        )}
      >
        <span className="live-activity-focus-counter block">
          <span className="live-activity-focus-aligned block text-foreground">{label}</span>
        </span>
      </span>
    </span>
  );
}
