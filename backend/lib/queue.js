// ROX AI — Queue setup (BullMQ + Redis)
// Shared between server.js (which enqueues) and worker.js (which
// processes). Keeping heavy image/video jobs off the request thread
// means a burst of traffic queues up instead of crashing the API server —
// each job is retried automatically on failure and the queue survives
// a server restart because state lives in Redis, not memory.
//
// npm install bullmq ioredis
//
// Local dev: run Redis with `docker run -p 6379:6379 redis`
// Production: Railway/Render both offer a one-click Redis add-on —
// point REDIS_URL at it.

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null // required by BullMQ
});

const imageQueue = new Queue('rox-image-generation', { connection });
const videoQueue = new Queue('rox-video-generation', { connection });

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 500, // keep last 500 for debugging, drop the rest
  removeOnFail: 1000
};

module.exports = { connection, imageQueue, videoQueue, defaultJobOptions };
