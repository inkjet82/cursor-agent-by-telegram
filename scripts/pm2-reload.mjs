import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  const bat = path.join(root, "reload-bot.bat");
  const child = spawn("cmd.exe", ["/c", bat], {
    cwd: root,
    env: process.env,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref();
  console.log("reload-bot.bat scheduled");
} else {
  const npx = "npx";
  const child = spawn(
    npx,
    ["pm2", "restart", "cursor-tg-bot", "--update-env"],
    {
      cwd: root,
      env: process.env,
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();
  console.log("pm2 restart scheduled");
}
