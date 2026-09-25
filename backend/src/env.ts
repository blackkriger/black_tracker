import 'dotenv/config';

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 3100),
  databaseUrl: required('DATABASE_URL'),
  // Signs nothing on its own — it salts the session-token hash kept in the database, so a dump of the sessions table is not a set of usable cookies.
  sessionSecret: required('SESSION_SECRET'),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Attachments live on disk; only their metadata is in the database.
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  // Set on prod, where nginx terminates HTTPS: it puts `Secure` on the session cookie.
  secureCookies: process.env.SECURE_COOKIES === 'true',
};
