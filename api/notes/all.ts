import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const notes = await prisma.missionNote.findMany();
    return res.status(200).json({ data: notes });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
