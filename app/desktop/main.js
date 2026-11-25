// Método Camocim — app para Windows (Electron). Abre o app embutido, sem depender do site.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

function criar() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 560,
    title: "Método Camocim", icon: path.join(__dirname, "www", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  Menu.setApplicationMenu(null);
  // Links externos (e-mail, WhatsApp, buscas de provas) abrem no navegador do computador
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); shell.openExternal(url); } });
  win.loadFile(path.join(__dirname, "www", "index.html"));
}
app.whenReady().then(criar);
app.on("window-all-closed", () => app.quit());
