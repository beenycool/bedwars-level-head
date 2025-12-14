
const Redis = require('ioredis');

const url = 'redis://default:uT4VkgyZ5YADmOFqI2TSrjwwnpO41tvW@redis-17417.crce204.eu-west-2-3.ec2.cloud.redislabs.com:17417';

console.log('Testing connection to:', url);

const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: null
});

redis.on('error', (err) => {
    console.error('Connection failed:', err.message);
    redis.quit();
});

redis.on('connect', () => {
    console.log('Connected successfully!');
    redis.quit();
});
