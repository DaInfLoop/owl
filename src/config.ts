export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  function required(name: string) {
    const value = env[name]?.trim();
    if (!value) throw new Error(`yo i need ${name}`);
    return value;
  }
  function integer(name: string, fallback: number, max: number) {
    const value = Number(env[name] ?? fallback);
    return value;
  }
  return {
    databaseUrl: required('DATABASE_URL'),
    token: required('SLACK_BOT_TOKEN'),
    signingSecret: required('SLACK_SIGNING_SECRET'),
    channels: { post: required('POST_CHANNEL'), review: required('REVIEW_CHANNEL'), log: required('LOG_CHANNEL') },
    port: integer('PORT', 8080, 65535),
    poolSize: integer('DB_POOL_SIZE', 10, 100),
  };
}
export type Config = ReturnType<typeof readConfig>;
