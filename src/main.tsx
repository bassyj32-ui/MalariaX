import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted and bundled, so the app has no runtime dependency on a font CDN —
// a first load in a rural area cannot be asked to depend on fonts.gstatic.com
// being reachable.
//
// Subset imports are deliberate. The default entry points pull cyrillic and
// latin-ext as well as latin, which cost ~180KB of the bundle and serve a
// country that does not need them. Amharic gets Noto Sans Ethiopic at a
// co-equal weight rather than as a fallback.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource-variable/noto-sans-ethiopic/wght.css';

import './i18n';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);