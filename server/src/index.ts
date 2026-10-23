import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';

const applied = await migrate();
if (applied.length) console.log('Migraciones aplicadas:', applied.join(', '));
createApp().listen(config.port, () => console.log(`Operaciones en http://localhost:${config.port}${config.basePath}/ (acceso: ${config.authMode})`));
