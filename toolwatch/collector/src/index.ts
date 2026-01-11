import path from "node:path";
import { ToolwatchDB } from "./db.js";
import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "9999");
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "toolwatch.db");

console.log(`Starting toolwatch collector`);
console.log(`  Database: ${DB_PATH}`);
console.log(`  Port: ${PORT}`);

const db = new ToolwatchDB(DB_PATH);
const server = createServer(db, PORT);

server.listen(PORT, () => {
  console.log(`  UI: http://localhost:${PORT}`);
  console.log(`  API: http://localhost:${PORT}/events (POST)`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close();
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  db.close();
  process.exit(0);
});
