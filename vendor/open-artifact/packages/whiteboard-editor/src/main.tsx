/** Entry point of the Whiteboard editor page. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, TooltipProvider } from '@open-artifact/ui';
import { App } from './App.tsx';
import { prepareBoardLoad } from './services/load-recovery.ts';
import './styles.css';

void prepareBoardLoad().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
));
