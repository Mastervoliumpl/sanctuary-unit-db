import { useEffect } from 'react';
import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/modding')({
  component: ModdingLayout,
});

function ModdingLayout() {
  useEffect(() => {
    document.documentElement.classList.add('modding-route');
    return () => document.documentElement.classList.remove('modding-route');
  }, []);

  return <Outlet />;
}
