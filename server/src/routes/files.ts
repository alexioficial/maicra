import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ApiError } from '../errors.js';

const pathQuery = z.object({ path: z.string().max(4096).default('/') });
const writeBody = z.object({ path: z.string().min(1).max(4096), content: z.string().max(5 * 1024 * 1024) });
const pathBody = z.object({ path: z.string().min(1).max(4096) });
const folderBody = z.object({ path: z.string().min(1).max(4096), parents: z.boolean().optional() });
const renameBody = z.object({ path: z.string().min(1).max(4096), name: z.string().min(1).max(255) });

function attachment(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function fileRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { files } = ctx;

  app.get('/api/files', async (request) => files.list(pathQuery.parse(request.query).path));

  app.get('/api/files/content', async (request) => ({ content: await files.readText(pathQuery.parse(request.query).path) }));

  app.put('/api/files/content', { bodyLimit: 6 * 1024 * 1024 }, async (request) => {
    const { path, content } = writeBody.parse(request.body);
    await files.writeText(path, content);
    return { ok: true };
  });

  // With "parents" the call creates missing parent folders and succeeds if the folder is already there.
  app.post('/api/files/folder', async (request) => {
    const { path, parents } = folderBody.parse(request.body);
    if (parents) await files.ensureDirs(path);
    else await files.mkdir(path);
    return { ok: true };
  });

  app.post('/api/files/file', async (request) => {
    await files.createFile(pathBody.parse(request.body).path);
    return { ok: true };
  });

  app.post('/api/files/rename', async (request) => {
    const { path, name } = renameBody.parse(request.body);
    await files.rename(path, name);
    return { ok: true };
  });

  app.delete('/api/files', async (request) => {
    await files.remove(pathQuery.parse(request.query).path);
    return { ok: true };
  });

  app.post('/api/files/upload', async (request) => {
    const { path: directory } = pathQuery.parse(request.query);
    if (!request.isMultipart()) throw new ApiError(400, 'invalid_request', 'Send the file as multipart form data');
    const saved: string[] = [];
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;
      saved.push(await files.saveUpload(directory, part.filename, part.file));
    }
    return { saved };
  });

  app.get('/api/files/download', async (request, reply) => {
    const { stream, size, name } = await files.openRead(pathQuery.parse(request.query).path);
    reply.header('content-length', size);
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', attachment(name));
    return reply.send(stream);
  });

  // The latest server log, as written by Minecraft itself.
  app.get('/api/log', async () => ({ text: await files.tail('/logs/latest.log', 512 * 1024) }));

  app.get('/api/log/download', async (_request, reply) => {
    const { stream, size, name } = await files.openRead('/logs/latest.log');
    reply.header('content-length', size);
    reply.header('content-type', 'text/plain; charset=utf-8');
    reply.header('content-disposition', attachment(name));
    return reply.send(stream);
  });
}
