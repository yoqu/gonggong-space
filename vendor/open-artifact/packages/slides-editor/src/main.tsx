/** Entry point of the Slides editor page. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, TooltipProvider } from '@open-artifact/ui';
import { App } from './App.tsx';
import { InlineView } from './components/InlineView.tsx';
import { isInlineView } from './lib/inline-view.ts';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      {isInlineView(window) ? <InlineView /> : <App />}
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
);
