import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { aplicarTema } from './theme';
aplicarTema();
const start = () => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
// el build «demo» (GitHub Pages) responde la API con datos grabados; en los demás builds este bloque desaparece
if (import.meta.env.MODE === 'demo') import('./demo').then(start); else start();
