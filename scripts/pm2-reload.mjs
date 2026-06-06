import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const child = spawn(
  npx,
  ["pm2", "restart", "cursor-tg-bot", "--update-env"],
  {
    cwd: root,
    env: process.env,
    stdio: "ignore",
    detached: true,
    shell: false,
  },
);

child.unref();
console.log("pm2 restart scheduled");
