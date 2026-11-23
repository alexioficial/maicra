import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { PLAYER_LISTS } from '../types.js';

const listParams = z.object({ list: z.enum(PLAYER_LISTS) });
const addBody = z.object({ value: z.string().min(1).max(64) });
const removeQuery = z.object({ id: z.string().min(1).max(64) });

export async function playerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { players } = ctx;

  app.get('/api/players/:list', async (request) => {
    const { list } = listParams.parse(request.params);
    return { entries: await players.list(list) };
  });

  app.post('/api/players/:list', async (request) => {
    const { list } = listParams.parse(request.params);
    const { value } = addBody.parse(request.body);
    const message = await players.add(list, value);
    return { message, entries: await players.list(list) };
  });

  app.delete('/api/players/:list', async (request) => {
    const { list } = listParams.parse(request.params);
    const { id } = removeQuery.parse(request.query);
    const message = await players.remove(list, id);
    return { message, entries: await players.list(list) };
  });
}
