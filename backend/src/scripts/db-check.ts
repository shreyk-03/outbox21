import { prisma } from '../lib/prisma.js';

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  console.log('prisma: database connection ok');
}

main()
  .catch((err) => {
    console.error('prisma: database connection failed', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
