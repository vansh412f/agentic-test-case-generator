import { Prisma } from '@prisma/client';
import { z } from 'zod';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const JsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(JsonSchema), z.record(JsonSchema),
]));

export function toDatabaseJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const serialized: unknown = JSON.parse(JSON.stringify(value));
  const parsed = JsonSchema.parse(serialized);
  return parsed === null ? Prisma.JsonNull : parsed;
}
