// macOS vibrancy is a backdrop blur plus AppKit's own frost: solid color
// layers, a CAChameleonLayer tint and a saturation filter. That frost covers
// the desktop before the page paints, so the window reads as flat grey and the
// renderer's theme tint cannot match Windows, where Acrylic is nearly a plain
// blur. Keep the blur and remove the frost. AppKit rebuilds these private
// layers on appearance and backing changes, so callers reapply after those.
//
// Layer shape on macOS 26-27 (Electron 44, NSVisualEffectView):
//   NSViewBackingLayer > CALayer > [CABackdropLayer(sdrNormalize, gaussianBlur,
//   colorSaturate), CALayer(bg), CALayer(bg), CAChameleonLayer]

type Pointer = bigint;

interface ObjcApi {
  readonly strip: (contentView: Pointer) => number;
}

let objcApiPromise: Promise<ObjcApi> | undefined;

function loadObjcApi(): Promise<ObjcApi> {
  objcApiPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const library = "t3-objc";
    open({ library, path: "/usr/lib/libobjc.A.dylib" });
    const P = DataType.BigInt;
    const selectors = new Map<string, Pointer>();
    const sel = (name: string): Pointer => {
      let selector = selectors.get(name);
      if (selector === undefined) {
        selector = load({
          library,
          funcName: "sel_registerName",
          retType: P,
          paramsType: [DataType.String],
          paramsValue: [name],
        }) as Pointer;
        selectors.set(name, selector);
      }
      return selector;
    };
    const send = (target: Pointer, selector: string): Pointer =>
      load({
        library,
        funcName: "objc_msgSend",
        retType: P,
        paramsType: [P, P],
        paramsValue: [target, sel(selector)],
      }) as Pointer;
    const sendPointer = (target: Pointer, selector: string, value: Pointer): Pointer =>
      load({
        library,
        funcName: "objc_msgSend",
        retType: P,
        paramsType: [P, P, P],
        paramsValue: [target, sel(selector), value],
      }) as Pointer;
    const sendBoolean = (target: Pointer, selector: string, value: boolean): void => {
      load({
        library,
        funcName: "objc_msgSend",
        retType: DataType.Void,
        paramsType: [P, P, DataType.Boolean],
        paramsValue: [target, sel(selector), value],
      });
    };
    const className = (target: Pointer): string =>
      load({
        library,
        funcName: "object_getClassName",
        retType: DataType.String,
        paramsType: [P],
        paramsValue: [target],
      }) as string;
    const describe = (target: Pointer): string =>
      load({
        library,
        funcName: "objc_msgSend",
        retType: DataType.String,
        paramsType: [P, P],
        paramsValue: [send(target, "description"), sel("UTF8String")],
      }) as string;
    const items = (array: Pointer): Pointer[] => {
      if (array === 0n) return [];
      const count = Number(send(array, "count"));
      return Array.from({ length: count }, (_, index) =>
        sendPointer(array, "objectAtIndex:", BigInt(index)),
      );
    };
    const mutableArrayClass = load({
      library,
      funcName: "objc_getClass",
      retType: P,
      paramsType: [DataType.String],
      paramsValue: ["NSMutableArray"],
    }) as Pointer;

    const stripLayer = (layer: Pointer): void => {
      sendPointer(layer, "setBackgroundColor:", 0n);
      if (className(layer) === "CAChameleonLayer") {
        sendBoolean(layer, "setHidden:", true);
        return;
      }
      const filters = items(send(layer, "filters"));
      const kept = filters.filter((filter) => !describe(filter).includes("Saturat"));
      if (kept.length !== filters.length) {
        const replacement = send(mutableArrayClass, "array");
        for (const filter of kept) sendPointer(replacement, "addObject:", filter);
        sendPointer(layer, "setFilters:", replacement);
      }
      for (const child of items(send(layer, "sublayers"))) stripLayer(child);
    };

    const stripView = (view: Pointer): number => {
      let stripped = 0;
      if (className(view).includes("VisualEffectView")) {
        const layer = send(view, "layer");
        if (layer !== 0n) {
          stripLayer(layer);
          stripped += 1;
        }
      }
      for (const subview of items(send(view, "subviews"))) stripped += stripView(subview);
      return stripped;
    };

    return {
      // Electron places the effect view beside the web contents, so search
      // from the window's frame view rather than the content view.
      strip: (contentView) => {
        const frameView = send(contentView, "superview");
        return stripView(frameView === 0n ? contentView : frameView);
      },
    };
  });
  return objcApiPromise;
}

/** Returns how many effect views were stripped; 0 means vibrancy is not installed. */
export async function stripMacosVibrancyFrost(
  window: Pick<Electron.BrowserWindow, "getNativeWindowHandle" | "isDestroyed">,
): Promise<number> {
  const api = await loadObjcApi();
  if (window.isDestroyed()) return 0;
  return api.strip(window.getNativeWindowHandle().readBigUInt64LE(0));
}
