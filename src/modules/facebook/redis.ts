import IORedis from 'ioredis';
import { config } from '../../config';

let client: IORedis | null = null;

export function getFacebookRedis(): IORedis {
  if (!client) {
    client = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
  }
  return client;
}

const PREFIX = 'fb:';

export async function setWithTTL(key: string, value: string, ttlSeconds: number): Promise<void> {
  await getFacebookRedis().set(PREFIX + key, value, 'EX', ttlSeconds);
}

export async function getAndDelete(key: string): Promise<string | null> {
  const redis = getFacebookRedis();
  const fullKey = PREFIX + key;
  const val = await redis.get(fullKey);
  if (val !== null) await redis.del(fullKey);
  return val;
}

export async function get(key: string): Promise<string | null> {
  return getFacebookRedis().get(PREFIX + key);
}

export async function set(key: string, value: string, ttlSeconds: number): Promise<void> {
  await getFacebookRedis().set(PREFIX + key, value, 'EX', ttlSeconds);
}

export async function del(key: string): Promise<void> {
  await getFacebookRedis().del(PREFIX + key);
}
