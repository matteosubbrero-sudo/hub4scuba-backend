const { z } = require('zod');

const bookingSchema = z.object({
  userName: z.string().min(1),
  userEmail: z.string().email(),
  requestedDate: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date format (YYYY-MM-DD)' }),
  requestedSlot: z.string().optional(),
  notes: z.string().optional(),
  participants: z.number().int().positive().optional()
});

module.exports = { bookingSchema };