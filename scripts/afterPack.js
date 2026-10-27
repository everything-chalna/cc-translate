const fs = require("fs");
const path = require("path");

// Remove macOS metadata sidecars from packaged files.
module.exports = async function afterPack(context) {
  removeAppleDoubleFiles(context.appOutDir);
};

function removeAppleDoubleFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeAppleDoubleFiles(full);
    } else if (entry.name.startsWith("._")) {
      fs.unlinkSync(full);
    }
  }
}
