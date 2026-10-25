import { createRoot } from 'react-dom/client';
import './styles/app.css';
import App from './App';

try {
  const t = localStorage.getItem('theme');
  if (t) document.documentElement.dataset.theme = t;
} catch { /* stockage indisponible */ }

createRoot(document.getElementById('root')).render(<App />);
