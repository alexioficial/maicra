import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ApiError } from '../errors.js';
import { applyProperties, parseProperties } from '../properties.js';
import type { PropertiesResponse } from '../types.js';

const PROPERTIES_FILE = '/server.properties';
const updateBody = z.object({
  properties: z
    .record(z.string().min(1).max(100), z.string().max(2000))
    .refine((value) => Object.keys(value).length <= 200, 'Too many properties'),
});

export async function optionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { files } = ctx;

  app.get('/api/options/properties', async (): Promise<PropertiesResponse> => {
    const raw = await files.readRaw(PROPERTIES_FILE);
    return { exists: raw !== null, properties: raw === null ? {} : parseProperties(raw) };
  });

  // Changes are written to the file and take effect the next time the server starts.
  app.put('/api/options/properties', async (request): Promise<PropertiesResponse> => {
    const { properties } = updateBody.parse(request.body);
    const current = (await files.readRaw(PROPERTIES_FILE)) ?? '';
    let next: string;
    try {
      next = applyProperties(current, properties);
    } catch (error) {
      throw new ApiError(400, 'invalid_property', (error as Error).message);
    }
    await files.writeText(PROPERTIES_FILE, next);
    return { exists: true, properties: parseProperties(next) };
  });
}
