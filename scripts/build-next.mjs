import { spawn } from "node:child_process";

const env = { ...process.env };

for (const key of Object.keys(env)) {
  if (key === "npm_package_json" || key.startsWith("npm_package_")) {
    delete env[key];
  }
}

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "npx next build"], {
        stdio: "inherit",
        env,
      })
    : spawn("npx", ["next", "build"], {
        stdio: "inherit",
        env,
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
