import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL,
  pingInterval: 1000 * 60 * 3, // Send a heartbeat every 3 minutes to prevent Upstash from dropping the connection
  socket: {
    family: 4, // Force IPv4 to prevent DNS resolution looping in Node.js
    tls: true, // Explicitly enforce TLS
    rejectUnauthorized: false // Bypasses strict certificate checks (common requirement for cloud Redis)
  }
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Connected to Upstash Redis for OTPs!'));

await redisClient.connect();

export default redisClient;