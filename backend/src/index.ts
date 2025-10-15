import express from 'express';
import playerRouter from './routes/player';
import { HttpError } from './util/httpError';
import { SERVER_HOST, SERVER_PORT, CLOUD_FLARE_TUNNEL } from './config';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use('/api/player', playerRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, cause: err.causeCode, message: err.message });
    return;
  }

  console.error('Unexpected error', err);
  res.status(500).json({ success: false, cause: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
});

app.listen(SERVER_PORT, SERVER_HOST, () => {
  const location = CLOUD_FLARE_TUNNEL || `http://${SERVER_HOST}:${SERVER_PORT}`;
  console.log(`Levelhead proxy listening at ${location}`);
});
