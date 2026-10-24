import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Toaster } from './components/ui/sonner';
import { FileManager } from './components/FileManager';
import { Unlock } from './routes/Unlock';
import { Settings } from './routes/Settings';
import { ShareTokenPage } from './routes/ShareToken';

function AuthGuard({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'locked' | 'unlocked'
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/status').then(res => {
      if (res.ok) {
        // Try a protected endpoint to check auth
        fetch('/api/files?limit=0', { credentials: 'include' }).then(r => {
          if (r.status === 401) setStatus('locked');
          else setStatus('unlocked');
        }).catch(() => setStatus('locked'));
      }
    }).catch(() => setStatus('locked'));
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }
  if (status === 'locked') {
    return <Navigate to="/unlock" replace />;
  }
  return children;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/unlock" element={<Unlock />} />
        <Route path="/share/:token/*" element={<ShareTokenPage />} />
        <Route path="/settings" element={<AuthGuard><Settings /></AuthGuard>} />
        <Route path="/" element={<AuthGuard><FileManager /></AuthGuard>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
