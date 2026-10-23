type SetActiveAppearance = (handle: Buffer, active: boolean) => void;

let activeAppearancePromise: Promise<SetActiveAppearance> | undefined;

export function loadWindowsGlass(): Promise<SetActiveAppearance> {
  activeAppearancePromise ??= import("ffi-rs").then(
    ({ DataType, PointerType, createPointer, freePointer, load, open }) => {
      const library = "t3-window-glass-user32";
      open({ library, path: "user32.dll" });
      return (handle, active) => {
        const windowHandle =
          handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
        const enabled = createPointer({
          paramsType: [DataType.I32],
          paramsValue: [active ? 1 : 0],
        });
        // Electron's system backdrops otherwise flatten when the window deactivates.
        // WCA_FORCE_ACTIVEWINDOW_APPEARANCE changes DWM painting, not input focus.
        try {
          const applied = load({
            library,
            funcName: "SetWindowCompositionAttribute",
            retType: DataType.I32,
            paramsType: [
              DataType.BigInt,
              { attribute: DataType.I32, data: DataType.External, size: DataType.U64 },
            ],
            paramsValue: [windowHandle, { attribute: 15, data: enabled[0], size: 4 }],
          });
          if (applied === 0) throw new Error("Windows rejected the glass active appearance.");
        } finally {
          freePointer({
            paramsType: [DataType.I32],
            paramsValue: enabled,
            pointerType: PointerType.RsPointer,
          });
        }
      };
    },
  );
  return activeAppearancePromise;
}
