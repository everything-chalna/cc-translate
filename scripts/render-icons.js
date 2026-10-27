// Rasterize the editable SVG sources for macOS app and template icons.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.on('window-all-closed', event => event.preventDefault());
app.whenReady().then(async () => {
  for (const [source, target, size] of [
    ['icon.svg', 'icon-master.png', 1024],
    ['tray.svg', 'trayTemplate.png', 18],
    ['tray.svg', 'trayTemplate@2x.png', 36],
  ]) {
    const svg = fs.readFileSync(path.join(__dirname, '../assets', source), 'utf8');
    const win = new BrowserWindow({ width: size, height: size, show: false, frame: false,
      transparent: true, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>html,body{margin:0;background:transparent;width:100%;height:100%}svg{width:100%;height:100%;display:block}</style>${svg}`));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '../assets', target), image.resize({ width: size, height: size }).toPNG());
    win.destroy();
  }
  app.quit();
}).catch(err => { console.error(err); app.exit(1); });
