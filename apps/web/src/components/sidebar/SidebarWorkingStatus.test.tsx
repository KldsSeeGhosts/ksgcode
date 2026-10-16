// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SidebarWorkingStatus } from "./SidebarWorkingStatus";

let root: Root;
let container: HTMLDivElement;
let visibility = "visible";
let motion = Object.assign(new EventTarget(), { matches: false });
let observers: TestIntersectionObserver[] = [];

class TestIntersectionObserver {
  targets = new Set<Element>();
  disconnect = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }

  observe(element: Element) {
    this.targets.add(element);
  }

  unobserve(element: Element) {
    this.targets.delete(element);
  }

  report(target: Element, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  visibility = "visible";
  motion = Object.assign(new EventTarget(), { matches: false });
  observers = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  vi.stubGlobal("matchMedia", () => motion);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility as DocumentVisibilityState,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function statusElement() {
  const element = container.querySelector<HTMLElement>('[role="status"]');
  if (!element) throw new Error("Status was not rendered");
  return element;
}

describe("SidebarWorkingStatus", () => {
  it("pauses the mounted shimmer offscreen, while hidden, and when reduced motion is enabled", async () => {
    await act(async () => root.render(<SidebarWorkingStatus label="Working" />));
    const status = statusElement();
    const observer = observers[0]!;
    const state = () => status.style.getPropertyValue("--visible-animation-state");
    expect(state()).toBe("paused");

    observer.report(status, true);
    expect(state()).toBe("running");

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(state()).toBe("paused");

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(state()).toBe("running");

    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
    expect(state()).toBe("paused");

    motion.matches = false;
    motion.dispatchEvent(new Event("change"));
    observer.report(status, false);
    expect(state()).toBe("paused");
  });

  it("retains a single accessible label through goal changes and releases animation state on completion", async () => {
    await act(async () => root.render(<SidebarWorkingStatus label="Working" />));
    const status = statusElement();
    const observer = observers[0]!;
    observer.report(status, true);

    await act(async () => root.render(<SidebarWorkingStatus label="Goal" />));
    expect(statusElement()).toBe(status);
    expect(status.querySelector(".sr-only")?.textContent).toBe("Goal");
    expect(status.querySelector('[aria-hidden="true"]')?.textContent).toBe("Goal");
    expect(observers).toHaveLength(1);
    expect(status.style.getPropertyValue("--visible-animation-state")).toBe("running");

    await act(async () => root.render(<span role="status">Done</span>));
    expect(statusElement().textContent).toBe("Done");
    expect(observer.targets.size).toBe(0);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(status.style.getPropertyValue("--visible-animation-state")).toBe("paused");
    observer.report(status, true);
    expect(status.style.getPropertyValue("--visible-animation-state")).toBe("paused");
  });
});
