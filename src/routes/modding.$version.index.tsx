import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { getModdingSnapshot } from '../content/modding/registry';

export const Route = createFileRoute('/modding/$version/')({
  beforeLoad: ({ params }) => {
    const snapshot = getModdingSnapshot(params.version);
    if (!snapshot) throw notFound();
    throw redirect({ href: `/modding/${snapshot.id}/${snapshot.startPage}`, statusCode: 308 });
  },
});
