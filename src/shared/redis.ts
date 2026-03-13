import Redis from 'ioredis';
import Redlock from 'redlock';
import dotenv from 'dotenv';
dotenv.config();

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redis = new Redis({
  host: redisHost,
  port: redisPort,
});

export const redlock = new Redlock([redis], {
  driftFactor: 0.01,
  retryCount: 3,
  retryDelay: 200, // ms
  retryJitter: 200, // ms
});

export const acquireLock = async (resource: string, ttl: number) => {
  return await redlock.acquire([resource], ttl);
};
