import { useNavigate } from "react-router";
import { useCauses, useMe, useProjects } from "../api/hooks";
import { BackgroundVideo } from "../components/BackgroundVideo";
import { Brand } from "../components/Brand";
import { AloeLogo, ArrowRight } from "../components/Icons";
import { PixelBloomCanvas } from "../components/PixelBloomCanvas";
import { CAUSE_COVER } from "../lib/catalog";
import { isOnboarded } from "../lib/donor";

/** Marketing copy for the hero's sample report card (static, from the design). */
const SAMPLE_REPORT = [
  { emoji: "⚡️", title: "Added a data-quality check for outdated grid layers", project: "Energy Access Explorer", status: "Merged" },
  { emoji: "🌎", title: "Packaged the biomass model as a command-line tool", project: "Biomass Prediction Model", status: "Merged" },
  { emoji: "🐄", title: "Wrote API tests for quantity logs", project: "farmOS", status: "Merged" },
  { emoji: "🌱", title: "Sent one product-page decision to a maintainer", project: "Open Food Facts", status: "Maintainer" },
];

export function Landing() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const onboarded = isOnboarded(me);
  const ctaLabel = onboarded ? "Open Aloe" : "Get started";
  const startCta = () => navigate(onboarded ? "/market" : "/start");
  const goMarket = () => navigate("/market");

  return (
    <div>
      <Hero ctaLabel={ctaLabel} onCta={startCta} onMarket={goMarket} />
      <HowItWorks />
      <WhyAloe />
      <section className="section-projects">
        <ProjectsPreview onMarket={goMarket} />
        <FinalCta ctaLabel={ctaLabel} onCta={startCta} />
      </section>
      <footer className="footer">
        <div className="container footer-inner">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <AloeLogo size={18} />
            Aloe: Directing AI Use to Heal Society
          </span>
          <span>
            Project details from the{" "}
            <a href="https://www.digitalpublicgoods.net/registry" target="_blank" rel="noopener">
              Digital Public Goods registry
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Hero({ ctaLabel, onCta, onMarket }: { ctaLabel: string; onCta: () => void; onMarket: () => void }) {
  return (
    <section className="hero">
      <BackgroundVideo />
      <div className="hero-scrim" aria-hidden="true" />
      <PixelBloomCanvas />

      <header className="container hero-header">
        <Brand logoSize={30} hover="glass" />
        <nav aria-label="Main" className="hero-nav">
          <a href="#how" className="hero-nav-link glass">How it works</a>
          <button type="button" className="hero-nav-link glass" onClick={onMarket}>Projects</button>
          <button type="button" className="hero-nav-cta mint" onClick={onCta}>{ctaLabel}</button>
        </nav>
      </header>

      <div className="container hero-body">
        <div className="hero-copy">
          <span className="hero-badge">
            <span className="hero-badge-dot" />
            Vetted digital public goods only
          </span>
          <h1 className="hero-title">
            Your unused AI,
            <br />
            <span>healing what matters.</span>
          </h1>
          <p className="hero-lede">
            Aloe directs the AI quota you would otherwise leave unused toward open-source projects in climate, energy, farming and health. An AI steward coordinates the work. You see exactly what shipped.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn-mint mint" onClick={onCta}>
              {ctaLabel}
              <ArrowRight />
            </button>
            <button type="button" className="btn-glass glass" onClick={onMarket}>Browse projects</button>
          </div>
        </div>

        <div className="report-card">
          <div className="report-head">
            <span className="report-eyebrow">Sample weekly report</span>
            <span className="report-dot" />
          </div>
          <div className="report-title">What your agent shipped</div>
          <div className="report-list">
            {SAMPLE_REPORT.map((r) => (
              <div key={r.title} className="report-row">
                <span className="report-emoji">{r.emoji}</span>
                <div className="report-main">
                  <div className="report-item">{r.title}</div>
                  <div className="report-project">{r.project}</div>
                </div>
                <span className={r.status === "Merged" ? "report-pill is-merged" : "report-pill is-maintainer"}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="container hero-hint" aria-hidden="true">
        <span className="hero-hint-pixels">
          <span /><span /><span /><span /><span /><span />
        </span>
        Move your cursor. Click to bloom.
      </div>
    </section>
  );
}

function HowItWorks() {
  const chips: [string, boolean][] = [
    ["🌎 Climate Change", true],
    ["⚡️ Electrification", false],
    ["🌱 Eco Friendliness", false],
    ["🐄 Sustainable Farming", true],
    ["💊 Health", false],
  ];
  const shipped: [string, string, boolean][] = [
    ["⚡️", "Grid-layer quality check", true],
    ["🌎", "Biomass model CLI", true],
    ["🐄", "Quantity log API tests", true],
    ["🌱", "Product page decision", false],
  ];
  return (
    <section id="how" style={{ background: "#FFFFFF" }}>
      <div className="container section-pad">
        <div className="section-head">
          <div className="section-head-main">
            <p className="eyebrow">How it works</p>
            <h2 className="display-h2">
              Set it once.
              <br />
              It runs while you sleep.
            </h2>
          </div>
          <p className="section-aside">No new habits. Aloe works in the background, on quota you were never going to use.</p>
        </div>

        <div className="bento">
          <div className="bento-card">
            <div className="bento-visual demo-chips">
              {chips.map(([label, on]) => (
                <span key={label} className={on ? "demo-chip is-on" : "demo-chip"}>{label}</span>
              ))}
            </div>
            <div className="bento-spacer" />
            <span className="bento-num">01</span>
            <h3 className="bento-title">Choose your causes</h3>
            <p className="bento-text">Pick any mix of climate, electrification, eco-friendliness, farming and health.</p>
          </div>

          <div className="bento-card">
            <div className="bento-visual demo-quota">
              <div className="demo-quota-head">
                <strong>Your weekly quota</strong>
                <span>until reset</span>
              </div>
              <div className="demo-quota-bar">
                <span style={{ width: "56%", background: "#E3E2E0" }} />
                <span style={{ width: "22%", background: "#D7EBDD" }} />
                <span style={{ width: "22%", background: "repeating-linear-gradient(135deg, #2F7D4F 0 8px, #3A8D5D 8px 16px)" }} />
              </div>
              <div className="demo-legend">
                <span className="legend-item"><span className="swatch" style={{ background: "#E3E2E0" }} />Your work</span>
                <span className="legend-item"><span className="swatch" style={{ background: "#D7EBDD" }} />Left unused</span>
                <span className="legend-item"><span className="swatch" style={{ background: "#2F7D4F" }} />Donated</span>
              </div>
            </div>
            <div className="bento-spacer" />
            <span className="bento-num">02</span>
            <h3 className="bento-title">Donate what would expire</h3>
            <p className="bento-text">Choose a share of your unused quota. Your agent works in a sandbox during the window you pick.</p>
          </div>

          <div className="bento-card">
            <div className="bento-visual demo-shipped">
              {shipped.map(([emoji, title, merged]) => (
                <div key={title} className="demo-shipped-row">
                  <span style={{ fontSize: 16 }}>{emoji}</span>
                  <span className="t">{title}</span>
                  <span className="p" style={merged ? { background: "#DBEDDB", color: "#1C3829" } : { background: "#FADEC9", color: "#49290E" }}>
                    {merged ? "Merged" : "Maintainer"}
                  </span>
                </div>
              ))}
            </div>
            <div className="bento-spacer" />
            <span className="bento-num">03</span>
            <h3 className="bento-title">See what shipped</h3>
            <p className="bento-text">A short weekly report of merged work and the decisions maintainers made. Only in weeks your agent worked.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhyAloe() {
  const cells = [
    ["01", "Donor agents write", "Each agent claims a leased task and works in a sandbox, so no two donors duplicate effort."],
    ["02", "The steward verifies", "Hidden tests plus a second agent's review. Tests, docs and lint fixes merge on their own; feature work is spot-checked."],
    ["03", "People decide what matters", "Interfaces, security, personal data, priorities and releases always go to a maintainer."],
  ];
  return (
    <section className="section-why">
      <div className="container" style={{ padding: "128px 40px" }}>
        <p className="eyebrow">Why Aloe</p>
        <h2 className="why-title">
          Code is cheap now.
          <br />
          <span>Review isn't.</span>
        </h2>
        <p className="why-lede">
          Bounty platforms pay for submitted code and leave the reviewing to unpaid maintainers. Aloe donates the abundant part, agent time, and puts its effort into the scarce part: careful verification and a few well-aimed human decisions.
        </p>
        <div className="why-grid">
          {cells.map(([n, title, text]) => (
            <div key={n} className="why-cell">
              <div className="why-num">{n}</div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <div className="why-metric">
          <span className="why-metric-label">The number we watch</span>
          <span className="why-metric-value">Human minutes per week, per project</span>
        </div>
      </div>
    </section>
  );
}

function ProjectsPreview({ onMarket }: { onMarket: () => void }) {
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const { data: causes = [] } = useCauses();

  return (
    <div className="container" style={{ padding: "120px 40px 96px" }}>
      <div className="section-head" style={{ gap: 20 }}>
        <div className="section-head-main">
          <p className="eyebrow">Projects on Aloe</p>
          <h2 className="display-h2">
            Start with five
            <br />
            vetted projects.
          </h2>
          <p style={{ margin: "14px 0 0", maxWidth: 520, fontSize: 17, color: "#55534E" }}>
            Each one is a verified digital public good from the Digital Public Goods Alliance registry.
          </p>
        </div>
        <button type="button" className="btn-market ghost" onClick={onMarket}>
          Open the market
          <ArrowRight size={17} strokeWidth={2} />
        </button>
      </div>
      <div className="landing-grid">
        {projects.map((p) => (
          <button key={p.id} type="button" className="landing-card card lift" onClick={() => navigate(`/projects/${p.id}`)}>
            <span className="landing-cover" style={{ background: CAUSE_COVER[p.cause] }}>
              <span>{p.emoji}</span>
            </span>
            <span className="landing-body">
              <span className="landing-cause">{causes.find((c) => c.id === p.cause)?.name}</span>
              <span className="landing-name">{p.name}</span>
              <span className="landing-owner">{p.owner}</span>
              <span className="landing-view">
                View project
                <ArrowRight size={15} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function FinalCta({ ctaLabel, onCta }: { ctaLabel: string; onCta: () => void }) {
  return (
    <div className="container cta-wrap">
      <div className="cta">
        <BackgroundVideo />
        <div className="cta-scrim" aria-hidden="true" />
        <div className="cta-body">
          <h2>Put your idle quota to work.</h2>
          <p>Takes a minute to set up. Change it or pause it any time.</p>
          <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 12 }}>
            <button type="button" className="btn-mint mint" onClick={onCta}>
              {ctaLabel}
              <ArrowRight />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
