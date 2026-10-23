import { Router } from 'express';
import multer from 'multer';
import { need } from '../auth.js';
import { pool } from '../db.js';
import { bad } from '../http.js';
import { applyImport, previewImport, type ImportType } from '../services/importer.js';

export const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
importRouter.post('/importar/vista-previa', need('importar'), upload.single('archivo'), async (req, res) => {
  if (!req.file) throw bad('Adjunta el archivo Excel en el campo «archivo».');
  if (!/\.xlsx$/i.test(req.file.originalname)) throw bad('Solo se aceptan archivos .xlsx.');
  res.json(await previewImport(req.user!, String(req.body.tipo) as ImportType, req.file.originalname, req.file.buffer));
});
importRouter.post('/importar/:id/aplicar', need('importar'), async (req, res) => res.json(await applyImport(req.user!, req.params.id as string)));
importRouter.get('/importar', need('importar'), async (_req, res) => {
  res.json((await pool.query(`SELECT id, source, file_name AS "fileName", status, stats, created_at AS "createdAt", applied_at AS "appliedAt" FROM import_batches WHERE source <> 'demo' ORDER BY created_at DESC LIMIT 50`)).rows);
});
