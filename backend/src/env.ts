import 'dotenv/config';

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 3100),
  databaseUrl: required('DATABASE_URL'),
  // Salts every stored token hash (sessions, API tokens, invites); rotating it voids them all.
  sessionSecret: required('SESSION_SECRET'),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  secureCookies: process.env.SECURE_COOKIES === 'true',
};
