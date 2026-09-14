import { defineSocketContract } from 'redweb/contract';
import { z } from 'zod';

const position = { x: z.number().int().min(-100).max(100), y: z.number().int().min(-100).max(100) };

// Share this module with a browser or Node client. It imports no server application code.
export const match = defineSocketContract('1', {
    join: z.object({ name: z.string().trim().min(1).max(40) }).strict(),
    move: z.object(position).strict(),
    resume: z.object({ session: z.string().uuid() }).strict(),
    state: z.object({ session: z.string().uuid(), name: z.string(), ...position }).strict(),
});
