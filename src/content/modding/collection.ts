import { defineDocs } from 'fumadocs-mdx/macro';
import { pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

export const moddingDocs = defineDocs({
  dir: 'src/content/modding/docs',
  docs: {
    postprocess: {
      extractLinkReferences: true,
    },
    schema: pageSchema.extend({
      title: z.string().trim().min(1),
      description: z.string().trim().min(1),
      navTitle: z.string().trim().min(1),
    }),
  },
});
