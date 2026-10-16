export function JobDetailSkeleton() {
  return (
    <div aria-label="Loading job details" className="space-y-6 py-section-sm" role="status">
      <div className="skeleton-line h-44 w-full" />
      <div className="grid gap-6 lg:grid-cols-job-detail">
        <div className="space-y-6">
          <div className="skeleton-line h-96 w-full" />
          <div className="skeleton-line h-96 w-full" />
        </div>
        <div className="space-y-6">
          <div className="skeleton-line h-48 w-full" />
          <div className="skeleton-line h-64 w-full" />
          <div className="skeleton-line h-80 w-full" />
        </div>
      </div>
    </div>
  );
}

export function JobsListSkeleton() {
  return (
    <div aria-label="Loading jobs" className="space-y-3" role="status">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="skeleton-line h-20 w-full" key={index} />
      ))}
    </div>
  );
}

export function HomeWorkspaceSkeleton() {
  return (
    <div aria-label="Loading workspace" className="space-y-4" role="status">
      <div className="skeleton-line h-12 w-full" />
      <div className="skeleton-line h-40 w-full" />
      <div className="skeleton-line h-64 w-full" />
    </div>
  );
}
