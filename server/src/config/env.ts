import dotenv from 'dotenv';
import { z } from 'zod';
import { loadThresholds, type Thresholds } from './thresholds.js';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECRET: z.string().min(16, 'COOKIE_SECRET must be at least 16 characters long').default('default_dev_secret_at_least_32_characters_long!'),
  
  DATABASE_URL: z.string().url().optional(),

  // Storage: Local storage (no S3)
  UPLOAD_DIR: z.string().default('./uploads'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export interface AppConfig {
  env: z.infer<typeof envSchema>;
  thresholds: Thresholds;
  isProd: boolean;
}

export const config: AppConfig = {
  env: parsed.data,
  thresholds: loadThresholds(process.env),
  isProd: parsed.data.NODE_ENV === 'production',
};
