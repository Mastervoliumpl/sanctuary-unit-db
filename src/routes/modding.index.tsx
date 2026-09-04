import { createFileRoute, redirect } from '@tanstack/react-router';
import { DEFAULT_MODDING_SNAPSHOT } from '../content/modding/registry';

export const Route = createFileRoute('/modding/')({
  beforeLoad: () => {
    throw redirect({
      href: `/modding/${DEFAULT_MODDING_SNAPSHOT.id}/${DEFAULT_MODDING_SNAPSHOT.startPage}`,
      statusCode: 308,
    });
  },
});
