import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export default async function handler(req: any, res: any) {
  const { missionId } = req.query;

  if (req.method === 'GET') {
    const note = await prisma.missionNote.findUnique({
      where: { missionId: String(missionId) }
    });
    return res.status(200).json({ data: note || { adminNote: '', schemaNote: '' } });
  }

  if (req.method === 'POST') {
    const { adminNote, schemaNote } = req.body;
    const updated = await prisma.missionNote.upsert({
      where: { missionId: String(missionId) },
      update: { adminNote: adminNote || '', schemaNote: schemaNote || '' },
      create: {
        missionId: String(missionId),
        adminNote: adminNote || '',
        schemaNote: schemaNote || ''
      }
    });
    return res.status(200).json({ success: true, data: updated });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
