const { z } = require('zod');

const createExperienceSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  locationName: z.string().min(1),
  priceBase: z.number().nonnegative().optional(),
  durationMinutes: z.number().int().positive().optional(),
  type: z.string().optional(),
  level: z.string().optional(),
  profile: z.string().optional(),
  entryType: z.string().optional(),
  environment: z.string().optional(),
  minDepthM: z.number().int().nonnegative().optional(),
  maxDepthM: z.number().int().nonnegative().optional()
});

const updateExperienceSchema = createExperienceSchema.partial();

module.exports = { createExperienceSchema, updateExperienceSchema };