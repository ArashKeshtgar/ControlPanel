import { createApp } from './app';

const apiKey = process.env.WUTILITY_API_KEY;
if (!apiKey) {
  console.error('WUTILITY_API_KEY must be set (the same value wUtility Web API is started with).');
  process.exit(1);
}

const app = createApp({
  apiBase: process.env.WUTILITY_API_BASE ?? 'http://localhost:5091',
  apiKey,
});

app.listen(4001, () => console.log('wutility-adapter listening on http://localhost:4001'));
