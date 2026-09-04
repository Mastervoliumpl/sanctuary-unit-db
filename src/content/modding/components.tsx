import type { AnchorHTMLAttributes, ComponentPropsWithoutRef, ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';
import type { ModdingSnapshot } from './registry';

function Kicker({ children }: { children: ReactNode }) {
  return <p className="docs-kicker">{children}</p>;
}

function Lead({ children }: { children: ReactNode }) {
  return <div className="docs-lede">{children}</div>;
}

function Callout({
  children,
  title,
  warning = false,
}: {
  children: ReactNode;
  title: string;
  warning?: boolean;
}) {
  return (
    <aside className={`docs-note${warning ? ' warning' : ''}`}>
      <h2>{title}</h2>
      <div>{children}</div>
    </aside>
  );
}

function Paths({ children }: { children: ReactNode }) {
  return <div className="docs-paths">{children}</div>;
}

function DefinitionGrid({ children }: { children: ReactNode }) {
  return <dl className="docs-definition-grid">{children}</dl>;
}

function Inventory({ children }: { children: ReactNode }) {
  return (
    <div className="docs-inventory" aria-label="Inspected content counts">
      {children}
    </div>
  );
}

function Settings({ children, fileLayout = false }: { children: ReactNode; fileLayout?: boolean }) {
  return <dl className={`docs-options${fileLayout ? ' docs-file-layout' : ''}`}>{children}</dl>;
}

function SurfaceList({ children }: { children: ReactNode }) {
  return <div className="docs-surface-list">{children}</div>;
}

function Steps(props: ComponentPropsWithoutRef<'ol'>) {
  return <ol {...props} className="docs-steps" />;
}

function SnapshotDetails({ snapshot }: { snapshot: ModdingSnapshot }) {
  const inspectedOn = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${snapshot.inspectedOn}T00:00:00Z`));

  return (
    <DefinitionGrid>
      <div>
        <dt>Game version</dt>
        <dd>{snapshot.gameVersion}</dd>
      </div>
      <div>
        <dt>Steam app</dt>
        <dd>{snapshot.steamApp}</dd>
      </div>
      <div>
        <dt>Steam build</dt>
        <dd>{snapshot.steamBuild}</dd>
      </div>
      <div>
        <dt>Unity version</dt>
        <dd>{snapshot.unityVersion}</dd>
      </div>
      <div>
        <dt>Inspected</dt>
        <dd>{inspectedOn}</dd>
      </div>
    </DefinitionGrid>
  );
}

function MdxLink({
  currentPath,
  href = '',
  snapshot,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { currentPath: string; snapshot: ModdingSnapshot }) {
  if (/^(?:[a-z]+:|#)/i.test(href)) return <a href={href} {...props} />;
  const base = `https://content.invalid/modding/${snapshot.id}/${currentPath}`;
  const resolved = new URL(href, base).pathname;
  return <a href={resolved} {...props} />;
}

export function getModdingMdxComponents(snapshot: ModdingSnapshot, currentPath: string): MDXComponents {
  return {
    a: (props) => <MdxLink {...props} currentPath={currentPath} snapshot={snapshot} />,
    Callout,
    DefinitionGrid,
    Inventory,
    Kicker,
    Lead,
    Paths,
    Settings,
    SnapshotDetails: () => <SnapshotDetails snapshot={snapshot} />,
    Steps,
    SurfaceList,
  };
}
