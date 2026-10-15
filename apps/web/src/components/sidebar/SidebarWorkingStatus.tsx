import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";

import styles from "./SidebarWorkingStatus.module.css";

/** Keep one accessible status label while its visual letters wave independently. */
export function SidebarWorkingStatus({ label }: { label: string }) {
  return (
    <span ref={observeVisibleAnimation} role="status" className="inline-flex">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="inline-flex">
        {Array.from(label, (letter, index) => (
          <span
            key={index}
            className={cn("inline-block", styles.letter)}
            style={{ animationDelay: `${index * 75}ms` }}
          >
            {letter}
          </span>
        ))}
      </span>
    </span>
  );
}
