// macOS glass uses WindowServer's background blur behind a transparent window,
// as Ghostty, kitty, iTerm2 and WezTerm do. Unlike NSVisualEffectView it adds
// no frost of its own, so the renderer's single theme tint decides the glass
// exactly as it does over Windows Acrylic. The call is private but has been
// stable for years; it takes effect immediately and persists with the window.

interface CoreGraphicsBlurApi {
  readonly setRadius: (windowNumber: number, radius: number) => number;
}

let blurApiPromise: Promise<CoreGraphicsBlurApi> | undefined;

function loadBlurApi(): Promise<CoreGraphicsBlurApi> {
  blurApiPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const library = "t3-coregraphics";
    open({ library, path: "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics" });
    const connection = load({
      library,
      funcName: "CGSMainConnectionID",
      retType: DataType.I32,
      paramsType: [],
      paramsValue: [],
    });
    return {
      setRadius: (windowNumber, radius) =>
        load({
          library,
          funcName: "CGSSetWindowBackgroundBlurRadius",
          retType: DataType.I32,
          paramsType: [DataType.I32, DataType.I32, DataType.I32],
          paramsValue: [connection, windowNumber, radius],
        }),
    };
  });
  return blurApiPromise;
}

export class MacosWindowBlurError extends Error {}

/** Electron's media source id is `window:<CGWindowID>:0`; that id is the WindowServer window number. */
export function parseMacosWindowNumber(mediaSourceId: string): number {
  const [kind, id] = mediaSourceId.split(":");
  const windowNumber = Number(id);
  if (kind !== "window" || !Number.isInteger(windowNumber) || windowNumber <= 0) {
    throw new MacosWindowBlurError(`unexpected media source id ${mediaSourceId}`);
  }
  return windowNumber;
}

export async function setMacosWindowBlur(
  window: Pick<Electron.BrowserWindow, "getMediaSourceId" | "isDestroyed">,
  radius: number,
): Promise<void> {
  const api = await loadBlurApi();
  if (window.isDestroyed()) return;
  const status = api.setRadius(parseMacosWindowNumber(window.getMediaSourceId()), radius);
  if (status !== 0)
    throw new MacosWindowBlurError(`CGSSetWindowBackgroundBlurRadius returned ${status}`);
}
