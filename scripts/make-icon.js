// Build macOS icon sizes from the generated master artwork.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BUILD_DIR = path.join(__dirname, "..", "build");
const masterPng = path.join(__dirname, "..", "assets", "icon-master.png");
const iconset = path.join(BUILD_DIR, "icon.iconset");
fs.mkdirSync(iconset, { recursive: true });
  const variants = [
    ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, px] of variants) {
    execFileSync("sips", ["-z", String(px), String(px), masterPng, "--out", path.join(iconset, name)], { stdio: "ignore" });
  }

  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(BUILD_DIR, "icon.icns")]);
fs.rmSync(iconset, { recursive: true, force: true });
console.log("Icon generated");
