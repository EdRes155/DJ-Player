// Función serverless de Vercel: voz del DJ con ElevenLabs.
// Toda la lógica (auth, límites, llamada a ElevenLabs) vive en _lib/tts.js.
import { createTtsHandler } from './_lib/tts.js';

const handle = createTtsHandler();

async function readBody(req) {
  if (req.body !== undefined) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) break; // un guion nunca pesa tanto
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const out = await handle({ method: req.method, headers: req.headers, body });
  res.statusCode = out.status;
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(out.body);
}
