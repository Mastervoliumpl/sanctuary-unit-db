import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/modding/$version')({
  component: Outlet,
});
