import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";

import styles from "./SidebarWorkingStatus.module.css";

/** Keep one accessible label while the timeline's highlight sweeps over stationary text. */
export function SidebarWorkingStatus({
  label,
  announce = true,
}: {
  label: string;
  /** Off when another region already announces the thread's status. */
  announce?: boolean;
}) {
  return (
    <span
      ref={observeVisibleAnimation}
      role={announce ? "status" : undefined}
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
