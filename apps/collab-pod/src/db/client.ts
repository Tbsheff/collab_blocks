import { PrismaClient } from '@prisma/client';

// Use a single Prisma client instance across the app
const prisma = new PrismaClient();

export default prisma; 