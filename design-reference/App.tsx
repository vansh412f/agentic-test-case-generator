import { useEffect, useMemo, useRef, useState } from "react";

type IconProps = { className?: string };
type View = "generate" | "history" | "keys" | "detail";
type Toast = { message: string; type: "success" | "error" } | null;

const Icon = ({ name, className = "size-4" }: IconProps & { name: string }) => {
  const paths: Record<string, React.ReactNode> = {
    spark: <><path d="m12 3-1.2 3.8A5 5 0 0 1 7.6 10L4 11.2l3.6 1.2a5 5 0 0 1 3.2 3.2L12 19l1.2-3.4a5 5 0 0 1 3.2-3.2l3.6-1.2-3.6-1.2a5 5 0 0 1-3.2-3.2L12 3Z"/><path d="m5 3 .4 1.2L7 5l-1.6.8L5 7l-.4-1.2L3 5l1.6-.8L5 3Z"/></>,
    github: <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7.4A5.8 5.8 0 0 0 19.2 3 5.4 5.4 0 0 0 19 0s-1.2-.4-4 1.5a13.4 13.4 0 0 0-7 0C5.2-.4 4 0 4 0a5.4 5.4 0 0 0-.2 3A5.8 5.8 0 0 0 2.2 7c0 5.8 3.5 7 6.8 7.4a4.8 4.8 0 0 0-1 3.5v4"/>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    alert: <><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4m0 3h.01"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3m-6 0 3 3"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></>,
    external: <><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    x: <path d="m6 6 12 12M18 6 6 18"/>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

const jobs = [
  { id: "#a1b2c3", url: "https://acme-store.vercel.app", status: "completed", passed: 14, failed: 1, corrected: 3, cases: 15, duration: "4m 12s", cost: "$0.0042", created: "Today, 10:42 AM" },
  { id: "#d4e5f6", url: "https://dashboard.northstar.io", status: "running", passed: 6, failed: 0, corrected: 1, cases: 12, duration: "2m 08s", cost: "$0.0021", created: "Today, 9:18 AM" },
  { id: "#79ab20", url: "https://docs.pixelbase.dev", status: "failed", passed: 2, failed: 3, corrected: 2, cases: 5, duration: "3m 45s", cost: "$0.0038", created: "Yesterday, 4:33 PM" },
  { id: "#c91dd8", url: "https://linear-clone.pages.dev", status: "completed", passed: 21, failed: 0, corrected: 4, cases: 21, duration: "6m 19s", cost: "$0.0065", created: "May 24, 2:10 PM" },
];

const terminalLines = [
  { kind: "command", content: "$ agent crawl https://acme-store.app" },
  { kind: "info", content: "↳ Discovered 4 pages · 37 interactive elements" },
  { kind: "plan", content: "◇ Planned: guest adds a product to cart" },
  { kind: "code", content: "await page.getByRole('button', { name: 'Add' }).click();" },
  { kind: "pass", content: "✓ PASS  cart.spec.ts  (2.4s)" },
  { kind: "correct", content: "↻ CORRECTED  locator → getByTestId('cart-count')" },
];

function StatusBadge({ status }: { status: string }) {
  const style = status === "completed" || status === "passed" ? "badge-green" : status === "running" ? "badge-blue" : "badge-red";
  return <span className={`badge ${style}`}><span className="badge-dot" />{status}</span>;
}

function Header({ view, navigate }: { view: View; navigate: (v: View) => void }) {
  return (
    <header className="header">
      <button className="brand" onClick={() => navigate("generate")}>
        <span className="logo-mark"><Icon name="spark" className="size-5" /></span>
        <span>Agentic<span>Test</span></span>
      </button>
      <nav>
        {(["generate", "history", "keys"] as View[]).map((item) => (
          <button key={item} className={(view === item || (view === "detail" && item === "history")) ? "active" : ""} onClick={() => navigate(item)}>
            {item === "keys" ? "API Keys" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <button className="icon-button" aria-label="Open GitHub repository"><Icon name="github" className="size-5" /></button>
    </header>
  );
}

function Terminal() {
  const [visible, setVisible] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => setVisible((v) => v >= terminalLines.length ? 1 : v + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="terminal">
      <div className="terminal-bar">
        <div className="traffic"><i /><i /><i /></div>
        <span>agent-session — zsh</span><span className="live"><i /> live</span>
      </div>
      <div className="terminal-body">
        {terminalLines.map((line, i) => <div key={i} className={`terminal-line ${line.kind} ${i < visible ? "show" : ""}`}><span className="line-no">{String(i + 1).padStart(2, "0")}</span><code>{line.content}</code>{i === visible - 1 && <span className="cursor" />}</div>)}
      </div>
    </div>
  );
}

function Stats() {
  return <div className="stats-strip">
    {[["1,284", "jobs run"], ["8,739", "test cases"], ["94.7%", "tests passed"], ["1,106", "auto-corrections"]].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
  </div>;
}

function LocalTarget({ onUse }: { onUse: (url: string) => void }) {
  const [tunnel, setTunnel] = useState("");
  const command = "cloudflared tunnel --url http://localhost:3000";
  return <section className="state-panel local-panel">
    <div className="state-icon"><Icon name="globe" className="size-6" /></div>
    <div className="state-copy">
      <p className="eyebrow">Local target detected</p>
      <h3>Your app is outside our reach</h3>
      <p>Our hosted agent can’t access localhost. Create a temporary public tunnel, then paste its URL below.</p>
      <div className="code-copy"><code>{command}</code><button onClick={() => navigator.clipboard?.writeText(command)} aria-label="Copy tunnel command"><Icon name="copy" /></button></div>
      <div className="inline-form"><input value={tunnel} onChange={(e) => setTunnel(e.target.value)} placeholder="https://your-app.trycloudflare.com" /><button onClick={() => tunnel && onUse(tunnel)}>Use tunnel URL <Icon name="arrow" /></button></div>
      <div className="warning"><Icon name="alert" /><span><strong>Security note:</strong> This tunnel makes your local app public while it runs. Stop cloudflared when testing is complete.</span></div>
      <p className="alternative">Prefer not to expose it? <button>Run the Agentic backend locally <Icon name="external" /></button></p>
    </div>
  </section>;
}

function AppMap({ onGenerate }: { onGenerate: () => void }) {
  const pages = [
    { path: "/", name: "Home", meta: "12 elements · 1 form" },
    { path: "/products", name: "Products", meta: "18 elements · 2 filters" },
    { path: "/cart", name: "Shopping cart", meta: "9 elements · 1 form" },
    { path: "/account/login", name: "Sign in", meta: "6 elements · 1 form" },
  ];
  const [selected, setSelected] = useState(pages.map((p) => p.path));
  return <section className="app-map">
    <div className="section-heading"><div><p className="eyebrow">Crawl complete</p><h2>App Map</h2><p>4 pages and 45 interactive elements discovered.</p></div><span className="success-pill"><Icon name="check" /> Healthy crawl</span></div>
    <div className="page-list">
      {pages.map((page) => <label key={page.path} className="page-row">
        <input type="checkbox" checked={selected.includes(page.path)} onChange={() => setSelected((s) => s.includes(page.path) ? s.filter((p) => p !== page.path) : [...s, page.path])} />
        <span className="page-icon"><Icon name="globe" /></span><span className="page-name"><strong>{page.name}</strong><code>{page.path}</code></span><span className="page-meta">{page.meta}</span>
      </label>)}
    </div>
    <div className="map-footer"><span>{selected.length} of {pages.length} pages selected</span><button className="primary-button" disabled={!selected.length} onClick={onGenerate}>Generate Tests <Icon name="arrow" /></button></div>
  </section>;
}

function GenerationProgress({ onComplete }: { onComplete: () => void }) {
  const steps = ["Crawl", "Plan", "Generate", "Validate", "Execute", "Correct"];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setActive((n) => {
      if (n >= steps.length - 1) { window.clearInterval(timer); window.setTimeout(onComplete, 700); return n; }
      return n + 1;
    }), 850);
    return () => window.clearInterval(timer);
  }, [onComplete]);
  return <section className="progress-panel">
    <div className="progress-top"><div><p className="eyebrow">Agent working</p><h2>Building your test suite</h2></div><span className="time-est"><Icon name="clock" /> ~2 min remaining</span></div>
    <div className="pipeline">{steps.map((step, i) => <div key={step} className={`pipe-step ${i < active ? "done" : i === active ? "current" : ""}`}><span>{i < active ? <Icon name="check" /> : i + 1}</span><strong>{step}</strong>{i < steps.length - 1 && <i />}</div>)}</div>
    <div className="current-work"><span className="spinner" /><div><strong>{active === 0 ? "Mapping interactive elements" : active === 1 ? "Planning user journeys" : active === 2 ? "Writing Playwright tests" : active === 3 ? "Validating assertions" : active === 4 ? "Executing in Chromium" : "Checking mechanical failures"}</strong><p>Test {Math.min(active + 2, 6)} of 8 · checkout as guest</p></div><span>{Math.round(((active + 1) / steps.length) * 100)}%</span></div>
    <div className="captcha"><span><Icon name="check" /></span><div><strong>Verification complete</strong><p>Automated abuse protection</p></div><small>BOT<br />GUARD</small></div>
  </section>;
}

function QuotaPanel({ onKey }: { onKey: () => void }) {
  return <section className="quota-panel"><div className="state-icon"><Icon name="clock" className="size-6" /></div><div><p className="eyebrow">Daily limit reached</p><h3>You’ve used today’s 3 free generations</h3><p>Your quota resets tomorrow at 00:00 UTC. Add your own provider key to keep generating now.</p><button className="primary-button" onClick={onKey}><Icon name="key" /> Add API key</button></div></section>;
}

function HowItWorks() {
  const steps = [
    ["01", "Crawl", "Discovers interactive elements, forms, and internal pages.", "18 elements · 1 form discovered"],
    ["02", "Plan", "Turns DOM evidence into structured user-journey test cases.", "Test case: “Add new todo item”"],
    ["03", "Generate", "Writes Playwright TypeScript using only verified crawl locators.", "page.getByRole('button', { name: 'Add' })"],
    ["04", "Validate", "Compiles with the TypeScript compiler before a browser launches.", "✓ PASS · tsc --noEmit"],
    ["05", "Self-Correction", "Retries mechanical failures with browser error context.", "locator timeout → corrected · assertions unchanged"],
  ];
  return <section className="how">
    <div className="how-heading"><div className="section-kicker">HOW IT WORKS</div><h2>How It Works</h2><p className="section-lead">An autonomous agent turns a live web app into self-healing Playwright test suites, grounded in real DOM evidence—not guessed selectors.</p></div>
    <div className="loop-heading"><span>THE EXECUTION LOOP</span><small>Live application → runnable test suite</small></div>
    <div className="agent-scene" aria-hidden="true">
      <div className="scene-grid" />
      <div className="orbit orbit-one"><i /><i /><i /><i /><i /></div>
      <div className="orbit orbit-two" />
      <div className="agent-core">
        <div className="core-top"><Icon name="spark" className="size-5" /><span>AGENT</span></div>
        <strong>DOM evidence</strong>
        <small>37 verified nodes</small>
      </div>
      <span className="scene-chip chip-crawl">01 · CRAWL</span>
      <span className="scene-chip chip-plan">02 · PLAN</span>
      <span className="scene-chip chip-code">03 · GENERATE</span>
      <span className="scene-chip chip-pass">04 · VALIDATE</span>
      <span className="scene-chip chip-fix">05 · CORRECT</span>
      <div className="scene-shadow" />
    </div>
    <div className="loop-grid">{steps.map(([n, title, desc, example], index) => <div className="loop-card" style={{ "--step": index } as React.CSSProperties} key={n}><div className="card-depth" /><div className="loop-number">{n}</div><h3>{title}</h3><p>{desc}</p><code>{example}</code></div>)}</div>
    <div className="taxonomy-wrap">
      <div><div className="section-kicker">FAILURE TAXONOMY</div><h2>Real bugs are never masked.</h2><p className="taxonomy-intro">Every failure is classified from browser output and test intent before the agent decides whether correction is allowed.</p>
        <div className="taxonomy">
          <div><i className="red" /><span><strong>Finding <b>REAL APPLICATION BUG</b></strong><small>Assertion failures and server errors are genuine defects. They are never rewritten or corrected—only surfaced as findings with evidence.</small></span></div>
          <div><i className="amber" /><span><strong>Locator &amp; Timeout <b>MECHANICAL</b></strong><small>Flaky selectors and DOM timing issues are sent to the corrector with browser logs and retried up to 2×.</small></span></div>
          <div><i className="green" /><span><strong>Assertion Preservation Guard</strong><small>Corrected code must retain 100% of the original assertions. Any revision that weakens test intent is rejected.</small></span></div>
        </div>
      </div>
      <div className="cost-card"><span className="mini-label">MEASURED TOKEN ECONOMY</span><div className="cost-equation"><strong>~14,500</strong><i>tokens</i><em>≈</em><strong>$0.004</strong><i>per suite</i></div><hr /><p className="cost-lifecycle"><span>Observe DOM</span><b>→</b><span>Plan journey</span><b>→</b><span>Generate TypeScript</span><b>→</b><span>Validate</span><b>→</b><span>Execute</span><b>→</b><span>Self-correct</span></p><small>Covers the full test-suite lifecycle, including correction attempts. Estimate varies with application size and model pricing.</small></div>
    </div>
  </section>;
}

function Generate({ navigate, notify }: { navigate: (v: View) => void; notify: (m: string, t?: "success" | "error") => void }) {
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<"idle" | "local" | "map" | "progress" | "quota">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);
  const crawl = () => {
    if (!url.trim()) { notify("Enter a URL to start crawling", "error"); inputRef.current?.focus(); return; }
    if (/localhost|127\.0\.0\.1/.test(url)) setStage("local");
    else if (url.toLowerCase().includes("quota")) setStage("quota");
    else { setStage("map"); notify("Crawl complete — 4 pages discovered"); }
  };
  return <>
    <main>
      <section className="hero">
        <div className="hero-copy"><span className="overline"><i /> PLAYWRIGHT TESTING, ON AUTOPILOT</span><h1>Your app,<br /><em>tested by agents.</em></h1><p>Paste a URL. Get production-ready Playwright tests that crawl, run, and self-correct—without hiding real bugs.</p>
          <div className="url-box"><div className="input-wrap"><Icon name="globe" className="size-5" /><input ref={inputRef} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && crawl()} placeholder="your-app.com" /><kbd>⌘ K</kbd></div><button onClick={crawl}>Crawl <Icon name="arrow" /></button></div>
          <p className="hint">Try an example: <button onClick={() => setUrl("https://acme-store.vercel.app")}>acme-store.vercel.app</button> <span>·</span> <button onClick={() => setUrl("http://localhost:3000")}>localhost demo</button> <span>·</span> <button onClick={() => { setUrl("quota-demo.app"); setStage("quota"); }}>quota state</button></p>
        </div>
        <Terminal />
      </section>
      <Stats />
      {stage === "local" && <LocalTarget onUse={(next) => { setUrl(next); setStage("map"); notify("Tunnel connected successfully"); }} />}
      {stage === "map" && <AppMap onGenerate={() => setStage("progress")} />}
      {stage === "progress" && <GenerationProgress onComplete={() => { notify("Test suite generated successfully"); navigate("detail"); }} />}
      {stage === "quota" && <QuotaPanel onKey={() => navigate("keys")} />}
      <HowItWorks />
    </main>
    <Footer />
  </>;
}

function History({ openJob }: { openJob: () => void }) {
  const [mode, setMode] = useState<"loaded" | "loading" | "empty" | "error">("loaded");
  if (mode === "loading") return <main className="page-main"><PageTitle eyebrow="RUN HISTORY" title="Previous generation jobs" text="Track every test run and inspect agent decisions." /><div className="history-skeleton">{[1,2,3,4].map(n => <div key={n} />)}</div><StateSwitcher value={mode} onChange={setMode} /></main>;
  if (mode === "empty") return <main className="page-main"><PageTitle eyebrow="RUN HISTORY" title="Previous generation jobs" text="Track every test run and inspect agent decisions." /><EmptyState onReset={() => setMode("loaded")} /><StateSwitcher value={mode} onChange={setMode} /></main>;
  if (mode === "error") return <main className="page-main"><PageTitle eyebrow="RUN HISTORY" title="Previous generation jobs" text="Track every test run and inspect agent decisions." /><ErrorBanner retry={() => setMode("loaded")} /><StateSwitcher value={mode} onChange={setMode} /></main>;
  return <main className="page-main"><PageTitle eyebrow="RUN HISTORY" title="Previous generation jobs" text="Track every test run and inspect agent decisions." />
    <div className="history-card"><div className="table-head table-grid"><span>JOB / TARGET</span><span>STATUS</span><span>RESULTS</span><span>CORRECTIONS</span><span>DURATION / COST</span><span>CREATED</span></div>
      {jobs.map((job) => <button className="job-row table-grid" onClick={openJob} key={job.id}><span className="job-target"><b>{job.id}</b><strong>{job.url.replace("https://", "")}</strong></span><span><StatusBadge status={job.status} /></span><span><b className="pass">{job.passed} passed</b><small>{job.failed} {job.failed === 1 ? "finding" : "findings"} · {job.cases} cases</small></span><span><b>{job.corrected}</b><small>applied</small></span><span><b>{job.duration}</b><small>{job.cost}</small></span><span><b>{job.created.split(",")[0]}</b><small>{job.created.includes(",") ? job.created.substring(job.created.indexOf(",") + 1) : ""}</small></span></button>)}
    </div><StateSwitcher value={mode} onChange={setMode} /></main>;
}

function StateSwitcher({ value, onChange }: { value: string; onChange: (v: "loaded" | "loading" | "empty" | "error") => void }) {
  return <div className="demo-switcher"><span>Preview states</span>{["loaded","loading","empty","error"].map(s => <button className={value === s ? "active" : ""} key={s} onClick={() => onChange(s as "loaded" | "loading" | "empty" | "error")}>{s}</button>)}</div>;
}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>;
}
function EmptyState({ onReset }: { onReset: () => void }) {
  return <div className="empty-state"><span><Icon name="spark" className="size-7" /></span><h2>No jobs yet</h2><p>Your generated test suites will appear here once you crawl your first app.</p><button className="primary-button" onClick={onReset}>View sample jobs</button></div>;
}
function ErrorBanner({ retry }: { retry: () => void }) {
  return <div className="error-banner"><span><Icon name="alert" /></span><div><strong>We couldn’t load your job history</strong><p>The service may be temporarily unavailable. Your jobs are safe.</p></div><button onClick={retry}><Icon name="refresh" /> Retry</button></div>;
}

const code = `import { test, expect } from '@playwright/test';

test('guest can add product to cart', async ({ page }) => {
  await page.goto('https://acme-store.vercel.app');
  await page.getByRole('link', { name: 'Products' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).first().click();

  await expect(page.getByTestId('cart-count')).toHaveText('1');
});`;

function TestCase({ name, status, attempts, corrected, failed }: { name: string; status: string; attempts: number; corrected?: boolean; failed?: boolean }) {
  const [open, setOpen] = useState(false);
  return <article className="test-case">
    <button className="test-summary" onClick={() => setOpen(!open)}><Icon name="chevron" className={`chev ${open ? "rotated" : ""}`} /><span className={`test-status-icon ${failed ? "failed" : ""}`}>{failed ? "!" : <Icon name="check" />}</span><span className="test-name"><strong>{name}</strong><small>{attempts} {attempts === 1 ? "attempt" : "attempts"} {corrected && "· auto-corrected"}</small></span><StatusBadge status={status} /></button>
    {open && <div className="test-details"><div className="detail-tabs"><button className="active">Test code</button>{corrected && <button>Correction diff</button>}{failed && <button>Error output</button>}</div>
      <div className="code-view"><div className="code-top"><span>tests/cart.spec.ts</span><button><Icon name="copy" /> Copy</button></div><pre><code>{code}</code></pre></div>
      {corrected && <div className="diff"><div><span>BEFORE · ATTEMPT 1</span><code>- page.locator('.cart-badge')</code></div><div><span>AFTER · ATTEMPT 2</span><code>+ page.getByTestId('cart-count')</code></div></div>}
      {failed && <div className="error-output"><span>FAILURE CATEGORY · <b>FINDING</b></span><code>Expected: "Order confirmed"<br />Received: "Payment processing failed"<br /><br />AssertionError: checkout confirmation was not displayed</code><p>Assertion preserved. This appears to be a real application defect and was not auto-corrected.</p></div>}
    </div>}
  </article>;
}

function JobDetail({ back, notify }: { back: () => void; notify: (m: string) => void }) {
  const [notFound, setNotFound] = useState(false);
  if (notFound) return <main className="page-main"><div className="not-found"><span><Icon name="globe" className="size-7" /></span><p className="eyebrow">JOB NOT FOUND</p><h1>This job lives on another backend</h1><p>It may have been created while your local Agentic backend was running. Reconnect that backend and refresh, or return to your hosted job history.</p><div><button className="secondary-button" onClick={back}>Back to history</button><button className="primary-button"><Icon name="refresh" /> Retry</button></div></div></main>;
  return <main className="page-main detail-page">
    <button className="back-link" onClick={back}>← All jobs</button>
    <section className="job-hero"><div><div className="job-title-line"><StatusBadge status="completed" /><span>#a1b2c3</span></div><h1>acme-store.vercel.app</h1><a>https://acme-store.vercel.app <Icon name="external" /></a></div><div className="job-actions"><button className="secondary-button" onClick={() => notify("HTML report download started")}><Icon name="download" /> Download Report</button><button className="primary-button" onClick={() => notify("Playwright project export started")}><Icon name="download" /> Export Playwright Project (.zip)</button></div></section>
    <div className="summary-grid">{[["93.3%","PASS RATE"],["4m 12s","DURATION"],["14,820","TOKENS"],["$0.0042","EST. COST"]].map(([v,l]) => <div key={l}><strong>{v}</strong><span>{l}</span></div>)}</div>
    <section className="detail-section"><div className="detail-heading"><div><p className="eyebrow">AGENT TRACE</p><h2>Execution timeline</h2></div><span>6 steps · 4m 12s total</span></div><div className="timeline">
      {[["Crawl","42s","2,180"],["Plan","31s","3,040"],["Generate","58s","5,860"],["Validate","18s","1,120"],["Execute","1m 36s","1,420"],["Correct","47s","1,200"]].map(([n,d,t],i) => <div key={n}><span className={i === 5 ? "corrected" : ""}><Icon name={i === 5 ? "refresh" : "check"} /></span><strong>{n}</strong><small>{d}<br />{t} tokens</small></div>)}
    </div></section>
    <section className="detail-section cases"><div className="detail-heading"><div><p className="eyebrow">GENERATED TESTS</p><h2>15 test cases</h2></div><div className="result-pills"><span>14 passed</span><span>1 finding</span><span>3 corrected</span></div></div>
      <TestCase name="Guest can add product to cart" status="passed" attempts={2} corrected />
      <TestCase name="User can filter products by category" status="passed" attempts={1} />
      <TestCase name="Checkout completes with valid payment" status="failed-finding" attempts={1} failed />
      <TestCase name="Cart quantity can be updated" status="passed" attempts={3} corrected />
    </section>
    <button className="not-found-demo" onClick={() => setNotFound(true)}>Preview job-not-found state</button>
  </main>;
}

function ApiKeys({ notify }: { notify: (m: string) => void }) {
  const [key, setKey] = useState("");
  return <main className="page-main keys-page"><PageTitle eyebrow="SETTINGS" title="Bring your own API key" text="Keep generating beyond the free daily quota. Your key is encrypted at rest." /><section className="key-card"><span className="state-icon"><Icon name="key" className="size-6" /></span><div><h2>Provider key</h2><p>Connect an OpenAI-compatible provider for agent planning and test generation.</p><label>API KEY<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-••••••••••••••••" /></label><button className="primary-button" onClick={() => key ? notify("API key saved securely") : notify("Enter an API key first")}>Save API key</button><small>Keys are only used for your generation jobs and are never included in exports.</small></div></section></main>;
}

function Footer() {
  return <footer><div className="brand"><span className="logo-mark"><Icon name="spark" className="size-4" /></span><span>Agentic<span>Test</span></span></div><p>Playwright tests that fix themselves, not your expectations.</p><div><button>Documentation</button><button>Privacy</button><button>GitHub</button></div><small>© 2025 Agentic Test</small></footer>;
}

export default function App() {
  const [view, setView] = useState<View>("generate");
  const [toast, setToast] = useState<Toast>(null);
  const notify = (message: string, type: "success" | "error" = "success") => { setToast({ message, type }); window.setTimeout(() => setToast(null), 3200); };
  const screen = useMemo(() => view === "generate" ? <Generate navigate={setView} notify={notify} /> : view === "history" ? <History openJob={() => setView("detail")} /> : view === "detail" ? <JobDetail back={() => setView("history")} notify={notify} /> : <ApiKeys notify={notify} />, [view]);
  return <div className="app"><Header view={view} navigate={setView} />{screen}{toast && <div className={`toast ${toast.type}`}><span>{toast.type === "success" ? <Icon name="check" /> : <Icon name="x" />}</span>{toast.message}<button onClick={() => setToast(null)} aria-label="Close notification"><Icon name="x" /></button></div>}</div>;
}
