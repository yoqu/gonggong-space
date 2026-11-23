import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CrashBoundary, Toaster, TooltipProvider } from '@open-artifact/ui';
import { App } from './App.tsx';
import { bootVideoApp } from './app/start.ts';
import { CRASH_ADVICE, CRASH_TITLE } from './app/words.ts';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');

const crashFallback = (
  <div role="alert" className="flex h-dvh flex-col items-center justify-center gap-1 bg-chrome px-6 text-center text-chrome-fg">
    <h1 className="text-[15px] font-medium">{CRASH_TITLE}</h1>
    <p className="text-[13px] text-chrome-muted">{CRASH_ADVICE}</p>
  </div>
);

bootVideoApp();
createRoot(root).render(
  <StrictMode>
    <CrashBoundary fallback={crashFallback}>
      <TooltipProvider>
        <App />
        <Toaster />
      </TooltipProvider>
    </CrashBoundary>
  </StrictMode>,
);
