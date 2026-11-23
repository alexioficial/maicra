import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, manager } = await buildApp(config);

  await manager.init();
  await app.listen({ port: config.port, host: config.host });

  // Stopping the panel never stops Minecraft: the server runs in its own container.
  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down the panel`);
    manager.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
