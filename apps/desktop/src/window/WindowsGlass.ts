type SetActiveAppearance = (handle: Buffer, active: boolean) => void;

let activeAppearancePromise: Promise<SetActiveAppearance> | undefined;

export function loadWindowsGlass(): Promise<SetActiveAppearance> {
  activeAppearancePromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const library = "t3-window-glass-user32";
    open({ library, path: "user32.dll" });
    return (handle, active) => {
      const windowHandle =
        handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
      // Paint WM_NCACTIVATE directly through the default procedure so DWM keeps
      // the system backdrop. Sending an activation message to Electron would
      // also change its focus bookkeeping; this only changes frame painting.
      load({
        library,
        funcName: "DefWindowProcW",
        retType: DataType.BigInt,
        paramsType: [DataType.BigInt, DataType.U32, DataType.BigInt, DataType.BigInt],
        paramsValue: [windowHandle, 0x86, active ? 1n : 0n, 0n],
      });
    };
  });
  return activeAppearancePromise;
}
