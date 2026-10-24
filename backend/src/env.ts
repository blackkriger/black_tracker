import 'dotenv/config';
import path from 'node:path';

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
  geoipDir: process.env.GEOIP_DIR ?? path.resolve(process.env.UPLOAD_DIR ?? './uploads', '..', 'geoip'),
  secureCookies: process.env.SECURE_COOKIES === 'true',
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
  publicUrl: (process.env.PUBLIC_URL ?? 'http://127.0.0.1:5174').replace(/\/$/, ''),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramBotName: process.env.TELEGRAM_BOT_NAME ?? '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  vkGroupToken: process.env.VK_GROUP_TOKEN ?? '',
  vkSecret: process.env.VK_SECRET ?? '',
  demoProject: process.env.DEMO_PROJECT ?? '',
};

export const telegramReady = (): boolean =>
  !!(env.telegramBotToken && env.telegramBotName && env.telegramWebhookSecret);

export const vkReady = (): boolean => !!(env.vkGroupToken && env.vkSecret);
