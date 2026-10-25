console.log(`Escape House launcher running on ${process.version} in ${process.cwd()}`);
process.on("uncaughtException", error => {
  console.error("Escape House uncaught exception", error);
  process.exitCode = 1;
});
process.on("unhandledRejection", reason => {
  console.error("Escape House unhandled rejection", reason);
  process.exitCode = 1;
});
try {
  await import(new URL("./dist/server.js", import.meta.url));
} catch (error) {
  console.error("Escape House module import failed", error);
  process.exitCode = 1;
}
