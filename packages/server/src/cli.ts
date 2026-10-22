import { resolve } from 'node:path';
import { loadDotEnv, readEnv } from './config.ts';
import { localAddresses, SERVER_VERSION, startServer } from './index.ts';

async function main(): Promise<void> {
  if (process.argv.includes('--version')) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  loadDotEnv(resolve(process.cwd(), '.env'));
  const env = readEnv();
  const server = await startServer({
    port: env.port,
    host: env.host,
    dataDir: env.dataDir,
    logDir: env.logDir,
    logLevel: env.logLevel,
    allowedOrigins: env.allowedOrigins,
    allowNoOrigin: env.allowNoOrigin,
    clientDir: env.clientDir,
    maxConnections: env.maxConnections,
    maxConnectionsPerIp: env.maxConnectionsPerIp,
    accountsPerIpPerHour: env.accountsPerIpPerHour,
    maxAccounts: env.maxAccounts,
    accountInactiveDays: env.accountInactiveDays,
    reportRetentionDays: env.reportRetentionDays,
    matchRetentionDays: env.matchRetentionDays,
    logRetentionDays: env.logRetentionDays,
    trustProxy: env.trustProxy,
  });

  const lines = [`Riverfront ${SERVER_VERSION} ouvindo na porta ${server.port}.`];
  const everywhere = env.host === '0.0.0.0' || env.host === '::';
  if (!everywhere) lines.push(`  Só nesta máquina (${env.host}).`);
  else for (const ip of localAddresses()) lines.push(`  Na rede local: ws://${ip}:${server.port}/ws${env.clientDir ? `  (jogo em http://${ip}:${server.port}/)` : ''}`);
  if (!env.dataDir) lines.push('  Atenção: DATA_DIR=memoria, nada será salvo em disco.');
  process.stderr.write(`${lines.join('\n')}\n`);

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) {
      process.exit(1);
    }
    stopping = true;
    process.stderr.write(`Recebido ${signal}, encerrando...\n`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((error: unknown) => {
  process.stderr.write(`Falha ao iniciar o servidor: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
