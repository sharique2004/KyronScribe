// Boot sequence: load config once, build the app, bind to loopback only (nginx fronts us).
import { loadConfig, getConfig } from './config.js';
import { createApp } from './app.js';
import { registerShutdown } from './db.js';

async function main(): Promise<void> {
  await loadConfig();
  const cfg = getConfig();

  const app = createApp();
  const server = app.listen(cfg.port, '127.0.0.1', () => {
    console.log(
      `[kyron-scribe] listening on http://127.0.0.1:${cfg.port} ` +
        `(env=${cfg.nodeEnv}, model=${cfg.scribeModel}, mock=${cfg.scribeMock})`,
    );
  });

  registerShutdown(server);
}

main().catch((err: unknown) => {
  console.error('[fatal] failed to start', err);
  process.exit(1);
});
