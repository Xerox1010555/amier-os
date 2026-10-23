import { app, Menu, nativeImage, Tray } from "electron";
import * as path from "path";

let trayItem: Tray | null = null;
let toggleFn: (() => void) | null = null;

const STATUS_TEMPLATE = [
  {
    label: "Show / Hide Amier",
    click: () => doToggle(),
  },
  { type: "separator" as const },
  { label: "AI Status: starting…", enabled: false, id: "status-line" },
  { type: "separator" as const },
  {
    label: "Quit",
    click: () => app.quit(),
  },
] satisfies Electron.MenuItemConstructorOptions[];

function doToggle(): void {
  toggleFn?.();
}

export function createTray(onToggle: () => void): void {
  toggleFn = onToggle;
  try {
    const iconPath = path.join(__dirname, "../../assets/jarvis-tray.png");
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      // 16×16 transparent placeholder so Windows never throws on missing asset.
      image = nativeImage.createFromBuffer(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf1/2sAAAAFUlEQVR42mNk+M9Qz0AE" +
            "YBxVSFASAABXqwE7XarHogAAAAASUVORK5CYII=",
          "base64",
        ),
      );
    }
    trayItem = new Tray(image);
    trayItem.setToolTip("Amier OS — starting");
    trayItem.setContextMenu(Menu.buildFromTemplate(STATUS_TEMPLATE));
    void updateStatusLine();
  } catch (err) {
    console.warn("[tray] unavailable", err);
    trayItem = null;
  }
}

export function destroyTray(): void {
  trayItem?.destroy();
  trayItem = null;
  toggleFn = null;
}

async function updateStatusLine(): Promise<void> {
  let line = "AI Status: service offline";
  try {
    const res = await fetch("http://127.0.0.1:8000/api/v1/health");
    line = res.ok ? "AI Status: online" : `AI Status: HTTP ${res.status}`;
  } catch {
    line = "AI Status: service offline";
  }
  if (trayItem) {
    trayItem.setToolTip(`Amier OS — ${line.replace("AI Status: ", "")}`);
  }
  const menu = Menu.buildFromTemplate(
    STATUS_TEMPLATE.map((item) =>
      (item as { id?: string }).id === "status-line" ? { ...item, label: line } : { ...item },
    ),
  );
  trayItem?.setContextMenu(menu);
}

export { trayItem as _pickTray, updateStatusLine };
