import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createDatabase } from './db/client.js';

const config = readConfig();
const database = createDatabase(config.databaseUrl, config.poolSize);
const { app, drain } = createApp(config, database);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 25_000);
    deadline.unref();
    try {
      await app.stop();
      await drain();
      await database.pool.end();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  });
}
try {
  await database.pool.query('SELECT id FROM confessions LIMIT 0');
  await app.init();
  await app.start(config.port);
  console.log(`owl up and ballin on port ${config.port}`);
} catch {
  console.error('shit broke homie');
  await database.pool.end();
  process.exitCode = 1;
}
