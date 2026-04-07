module.exports = {
  apps: [
    {
      name: "frontdesk-ai",
      cwd: __dirname,
      script: "npm",
      args: "start -- -p 3000 -H 127.0.0.1",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
