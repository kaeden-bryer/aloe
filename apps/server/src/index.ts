import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./database.ts";
import { seedIfEmpty } from "./seed.ts";

const { db, path } = openDatabase(); // also loads the repo-root .env
if (seedIfEmpty(db, Date.now())) console.log(`Seeded a fresh demo database at ${path}`);

const port = Number(process.env.PORT) || 8787;
serve({ fetch: createApp(db).fetch, port }, (info) => {
  console.log(`Aloe server listening on http://localhost:${info.port} (db: ${path})`);
});
