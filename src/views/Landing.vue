<script setup lang="ts">
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Users,
  Vote,
  Wallet,
} from '@lucide/vue';

const testnetUrl = 'https://testnet.app.daclify.com';
</script>

<template>
  <div class="landing">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="landing-header container">
      <a class="brand" href="/" aria-label="Daclify home"
        ><span class="brand-mark" aria-hidden="true">d.</span
        ><span>daclify<span class="brand-caption">GOVERN TOGETHER</span></span></a
      >
      <nav aria-label="Main navigation">
        <a href="#platform">The platform</a><a href="#launch">Launch status</a>
      </nav>
      <a class="button secondary header-cta" :href="testnetUrl"
        >Try testnet <ArrowUpRight aria-hidden="true"
      /></a>
    </header>

    <main id="main" tabindex="-1">
      <section class="hero container" aria-labelledby="hero-title">
        <div class="hero-copy">
          <a class="launch-badge" href="#launch"
            ><span aria-hidden="true"></span>Production coming soon<ArrowRight aria-hidden="true"
          /></a>
          <h1 id="hero-title">
            Your community.<br />Your decisions.<br /><span>One shared home.</span>
          </h1>
          <p class="hero-lead">
            Bring your people together to make decisions, organise work and manage shared resources.
            Daclify gives your community a place to move forward.
          </p>
          <div class="landing-actions">
            <a class="button" :href="testnetUrl"
              >Explore the testnet app <ArrowUpRight aria-hidden="true" /></a
            ><a class="learn-link" href="#platform"
              >Meet Daclify <ArrowRight aria-hidden="true"
            /></a>
          </div>
          <p class="hero-note">Explore today on testnet. Production is on its way.</p>
        </div>
        <div class="hero-visual">
          <svg class="community-orbit" viewBox="0 0 520 520" fill="none" aria-hidden="true">
            <circle cx="260" cy="260" r="244" stroke-dasharray="2 9" />
            <circle cx="260" cy="260" r="193" />
            <path d="M16 260h488M260 16v488" stroke-dasharray="2 9" />
          </svg>
          <div class="workspace-preview">
            <div class="preview-top">
              <span class="preview-mark" aria-hidden="true">d.</span
              ><span>THE COMMUNITY WORKSPACE</span><Blocks aria-hidden="true" />
            </div>
            <div class="preview-body">
              <p class="eyebrow">A SHARED PURPOSE. A PLACE TO ORGANISE.</p>
              <h2>Your community, connected.</h2>
              <p class="preview-description">Good ideas become shared action.</p>
              <div class="preview-tabs" aria-hidden="true">
                <span>Overview</span><span>Decisions</span><span>Work</span>
              </div>
              <div class="preview-row">
                <span class="preview-icon"><Users aria-hidden="true" /></span>
                <div>
                  <strong>Bring people together</strong
                  ><small>Members, roles and a shared purpose</small>
                </div>
                <Check aria-hidden="true" />
              </div>
              <div class="preview-row">
                <span class="preview-icon"><Vote aria-hidden="true" /></span>
                <div>
                  <strong>Give ideas a voice</strong
                  ><small>Proposals and community decisions</small>
                </div>
                <Check aria-hidden="true" />
              </div>
              <div class="preview-row">
                <span class="preview-icon"><Wallet aria-hidden="true" /></span>
                <div>
                  <strong>Put plans into motion</strong
                  ><small>Funded work and shared resources</small>
                </div>
                <Check aria-hidden="true" />
              </div>
              <div class="preview-bottom">
                <span
                  ><span class="connection-dot" aria-hidden="true"></span>People → Decisions →
                  Action</span
                ><ArrowRight aria-hidden="true" />
              </div>
            </div>
          </div>
          <p class="preview-caption">Illustrative workspace</p>
        </div>
      </section>

      <div class="audience container">
        <p>MADE FOR PEOPLE WHO BUILD TOGETHER</p>
        <div>
          <span>Communities</span><span>Cooperatives</span><span>Teams</span
          ><span>Collective projects</span>
        </div>
      </div>

      <section id="platform" class="platform-section container" aria-labelledby="platform-title">
        <div class="section-heading">
          <p class="eyebrow">LESS SCATTERED. MORE CONNECTED.</p>
          <h2 id="platform-title">From a shared purpose<br />to shared action.</h2>
          <p>
            The essentials for running a DAO — a community that makes decisions and manages
            resources together.
          </p>
        </div>
        <div class="feature-grid">
          <article class="feature">
            <span class="feature-icon"><Users aria-hidden="true" /></span>
            <h3>People with a purpose.</h3>
            <p>
              Bring members into one workspace, define roles and give your community a clear way to
              participate.
            </p>
            <span class="feature-detail">Membership &amp; roles</span>
          </article>
          <article class="feature">
            <span class="feature-icon"><Vote aria-hidden="true" /></span>
            <h3>Decisions made together.</h3>
            <p>
              Turn ideas into proposals, let members vote and keep your community's decisions in
              view.
            </p>
            <span class="feature-detail">Proposals &amp; governance</span>
          </article>
          <article class="feature">
            <span class="feature-icon"><FileText aria-hidden="true" /></span>
            <h3>A place to get things done.</h3>
            <p>
              Organise projects, manage shared funds and keep the documents behind your work in one
              place.
            </p>
            <span class="feature-detail">Work, treasury &amp; documents</span>
          </article>
        </div>
      </section>

      <section id="launch" class="launch-section container" aria-labelledby="launch-title">
        <div class="launch-panel">
          <div>
            <p class="eyebrow">THE NEXT CHAPTER</p>
            <h2 id="launch-title">Production is<br />coming soon.</h2>
            <p>
              We're preparing Daclify for production. In the meantime, you can explore the app, try
              the tools and get familiar with the workspace on testnet.
            </p>
            <a class="button" :href="testnetUrl"
              >Explore the testnet app <ArrowUpRight aria-hidden="true"
            /></a>
          </div>
          <div class="launch-info">
            <span class="launch-symbol" aria-hidden="true">d.</span>
            <div class="launch-status">
              <span class="connection-dot" aria-hidden="true"></span>Available to explore on testnet
            </div>
            <p>
              The testnet app is a testing environment. Use test assets and treat your activity as
              experimentation.
            </p>
            <a class="learn-link" :href="`${testnetUrl}/docs`"
              ><BookOpen aria-hidden="true" />Read the handbook<ArrowUpRight aria-hidden="true"
            /></a>
          </div>
        </div>
      </section>

      <section class="faq-section container" aria-labelledby="faq-title">
        <div class="section-heading">
          <p class="eyebrow">A FEW THINGS TO KNOW</p>
          <h2 id="faq-title">Good questions.<br />Straight answers.</h2>
        </div>
        <div class="faq-list">
          <details>
            <summary>When will production launch?<ChevronDown aria-hidden="true" /></summary>
            <p>
              A launch date has not been announced. This page will be updated when the production
              app is ready.
            </p>
          </details>
          <details>
            <summary>What can I do on testnet?<ChevronDown aria-hidden="true" /></summary>
            <p>
              Explore the DAO Hub, try creating a community and learn how membership, voting, work
              and treasury tools fit together. The handbook in the testnet app explains how to get
              started.
            </p>
          </details>
          <details>
            <summary>Who is Daclify for?<ChevronDown aria-hidden="true" /></summary>
            <p>
              Communities, cooperatives, contributor groups and teams that want to give members a
              voice, organise shared work and manage resources together.
            </p>
          </details>
        </div>
      </section>

      <section class="closing-section container" aria-labelledby="closing-title">
        <p class="eyebrow">YOUR PEOPLE. YOUR PURPOSE. YOUR NEXT STEP.</p>
        <h2 id="closing-title">See what you can build together.</h2>
        <a class="button" :href="testnetUrl"
          >Explore the testnet app <ArrowUpRight aria-hidden="true"
        /></a>
      </section>
    </main>

    <footer class="landing-footer container">
      <a class="footer-brand" href="/" aria-label="Daclify home"
        >daclify<span>GOVERN TOGETHER</span></a
      >
      <p>Production coming soon. Testnet open to explore.</p>
      <a :href="`${testnetUrl}/docs`">Handbook <ArrowUpRight aria-hidden="true" /></a
      ><a :href="`${testnetUrl}/docs/privacy`">Privacy &amp; trust</a>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  overflow: clip;
}
.landing main {
  padding: 0;
  max-width: none;
  min-height: 0;
}
.container {
  width: min(1160px, calc(100% - 80px));
  margin-inline: auto;
}
.landing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 112px;
  border-bottom: 1px solid var(--border-default);
}
.brand {
  margin: 0;
  flex: none;
}
.landing-header nav {
  display: flex;
  gap: 10px;
}
.landing-header nav a {
  min-height: 44px;
  align-items: center;
}
.header-cta {
  font-size: 14px;
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  align-items: center;
  gap: 50px;
  padding-block: 100px 96px;
}
.launch-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-amber);
  font-size: 12px;
  font-weight: 600;
}
.launch-badge > span,
.connection-dot {
  width: 6px;
  height: 6px;
  background: var(--accent-amber);
  border-radius: 50%;
  flex: none;
}
.launch-badge svg,
.learn-link svg,
.landing-footer svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.hero h1 {
  font-size: clamp(38px, 4.5vw, 64px);
  font-weight: 650;
  letter-spacing: -2.8px;
  line-height: 1.12;
  margin: 28px 0 24px;
}
.hero h1 span {
  color: var(--accent-amber);
}
.hero-lead {
  max-width: 480px;
  font-size: 17px;
  line-height: 1.8;
  color: var(--text-secondary);
}
.landing-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 22px;
  margin-top: 30px;
}
.learn-link {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.hero-note {
  margin: 18px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}
.hero-visual {
  position: relative;
  padding-block: 30px;
  min-width: 0;
}
.community-orbit {
  position: absolute;
  width: 115%;
  height: 115%;
  top: -8%;
  left: -7.5%;
  stroke: var(--border-warm);
  opacity: 0.65;
  pointer-events: none;
}
.workspace-preview {
  position: relative;
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  box-shadow: var(--elevation-panel);
}
.preview-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border-default);
  color: var(--text-muted);
  font-size: 9px;
  letter-spacing: 1.7px;
  font-weight: 600;
}
.preview-mark {
  color: var(--accent-amber);
  font-size: 26px;
  font-weight: 750;
  letter-spacing: -2px;
}
.preview-top > svg {
  width: 16px;
  margin-left: auto;
}
.preview-body {
  padding: 28px 24px 20px;
}
.preview-body .eyebrow {
  font-size: 8px;
  letter-spacing: 1px;
}
.preview-body h2 {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
}
.preview-description {
  font-size: 12px;
  color: var(--text-muted);
}
.preview-tabs {
  display: flex;
  gap: 22px;
  font-size: 11px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-default);
  margin-top: 24px;
}
.preview-tabs span {
  padding-bottom: 12px;
}
.preview-tabs span:first-child {
  color: var(--accent-amber);
  border-bottom: 2px solid var(--accent-amber);
}
.preview-row {
  display: flex;
  align-items: center;
  gap: 13px;
  padding-block: 18px;
  border-bottom: 1px solid var(--border-default);
}
.preview-icon,
.feature-icon {
  display: grid;
  place-items: center;
  flex: none;
  border: 1px solid var(--border-warm);
  background: var(--accent-soft);
  border-radius: var(--radius-md);
  color: var(--accent-amber);
}
.preview-icon {
  width: 36px;
  height: 36px;
}
.preview-icon svg {
  width: 17px;
  height: 17px;
}
.preview-row strong,
.preview-row small {
  display: block;
}
.preview-row strong {
  font-size: 12px;
  font-weight: 550;
}
.preview-row small {
  color: var(--text-muted);
  font-size: 10px;
  margin-top: 6px;
}
.preview-row > svg {
  width: 14px;
  height: 14px;
  color: var(--accent-amber);
  margin-left: auto;
  flex: none;
}
.preview-bottom,
.preview-bottom > span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-bottom {
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 10px;
  padding-top: 20px;
}
.preview-bottom > svg {
  width: 14px;
  height: 14px;
  color: var(--accent-amber);
}
.preview-caption {
  position: relative;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
  margin: 16px 0 0;
}
.audience {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding-block: 28px;
  border-block: 1px solid var(--border-default);
}
.audience p {
  margin: 0;
  font-size: 9px;
  letter-spacing: 1.6px;
  color: var(--text-muted);
}
.audience > div {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 550;
}
.platform-section,
.faq-section {
  padding-block: 96px;
}
.section-heading h2,
.launch-panel h2,
.closing-section h2 {
  font-size: clamp(28px, 3vw, 40px);
  font-weight: 600;
  letter-spacing: -1.3px;
  line-height: 1.2;
  margin-bottom: 20px;
}
.section-heading > p:last-child {
  color: var(--text-muted);
  max-width: 500px;
  font-size: 15px;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 48px;
  margin-top: 48px;
}
.feature-icon {
  width: 44px;
  height: 44px;
  margin-bottom: 24px;
}
.feature-icon svg {
  width: 20px;
  height: 20px;
}
.feature h3 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.5px;
  margin-bottom: 14px;
}
.feature p {
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.8;
  margin-bottom: 22px;
}
.feature-detail {
  display: block;
  padding-top: 20px;
  border-top: 1px solid var(--border-default);
  color: var(--accent-amber);
  font-size: 11px;
  font-weight: 550;
}
.launch-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  align-items: center;
  gap: 80px;
  padding: 56px;
  background: var(--surface-brand);
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-lg);
}
.launch-panel > div > p:not(.eyebrow) {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.8;
  margin-bottom: 26px;
}
.launch-info {
  border-left: 1px solid var(--border-warm);
  padding-left: 40px;
}
.launch-symbol {
  display: block;
  color: var(--accent-amber);
  font-size: 72px;
  font-weight: 750;
  letter-spacing: -6px;
  margin-bottom: 24px;
}
.launch-status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--accent-amber);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 14px;
}
.launch-panel .launch-info > p {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 10px;
}
.faq-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 80px;
}
.faq-list details {
  border-bottom: 1px solid var(--border-default);
}
.faq-list summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-block: 24px;
  font-size: 15px;
  font-weight: 550;
  cursor: pointer;
  list-style: none;
}
.faq-list summary::-webkit-details-marker {
  display: none;
}
.faq-list summary svg {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--accent-amber);
  transition: transform var(--motion-fast);
}
.faq-list details[open] summary svg {
  transform: rotate(180deg);
}
.faq-list p {
  font-size: 14px;
  color: var(--text-muted);
  padding-bottom: 12px;
  max-width: 520px;
}
.closing-section {
  text-align: center;
  padding-block: 20px 80px;
}
.closing-section h2 {
  margin: 16px 0 28px;
}
.landing-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 24px;
  padding-block: 32px;
  border-top: 1px solid var(--border-default);
}
.footer-brand {
  display: grid;
  align-content: center;
  min-height: 44px;
  color: var(--text-primary);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.7px;
}
.footer-brand span {
  display: block;
  font-size: 8px;
  letter-spacing: 1.5px;
  color: var(--text-muted);
  margin-top: 4px;
}
.landing-footer p {
  color: var(--text-muted);
  font-size: 11px;
  margin: 0 auto 0 0;
}
.landing-footer > a:not(.footer-brand) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  color: var(--text-secondary);
  font-size: 12px;
}
section[id] {
  scroll-margin-top: 28px;
}
@media (max-width: 1000px) {
  .hero {
    gap: 28px;
    padding-block: 72px;
  }
  .hero h1 {
    font-size: 48px;
    letter-spacing: -2px;
  }
  .feature-grid {
    gap: 28px;
  }
  .launch-panel {
    padding: 36px;
    gap: 32px;
  }
  .faq-section {
    gap: 40px;
  }
}
@media (max-width: 760px) {
  .container {
    width: calc(100% - 40px);
  }
  .landing-header {
    flex-wrap: wrap;
    gap: 12px;
    padding-block: 22px 12px;
  }
  .landing-header nav {
    order: 3;
    width: 100%;
    justify-content: center;
  }
  .brand {
    font-size: 25px;
  }
  .header-cta {
    padding-inline: 14px;
    font-size: 12px;
  }
  .hero,
  .feature-grid,
  .launch-panel,
  .faq-section {
    grid-template-columns: minmax(0, 1fr);
  }
  .hero {
    padding-block: 48px 36px;
    gap: 32px;
  }
  .hero h1 {
    font-size: clamp(34px, 7.5vw, 54px);
    letter-spacing: -1.8px;
  }
  .hero-lead {
    font-size: 16px;
  }
  .landing-actions {
    gap: 12px 22px;
  }
  .landing-actions .button {
    font-size: 14px;
  }
  .hero-visual {
    width: min(460px, 100%);
    margin-inline: auto;
  }
  .preview-body,
  .preview-top {
    padding-inline: 18px;
  }
  .preview-body h2 {
    font-size: clamp(19px, 4.5vw, 24px);
  }
  .audience {
    justify-content: center;
    text-align: center;
    gap: 18px;
  }
  .audience > div {
    justify-content: center;
    gap: 12px 24px;
  }
  .platform-section,
  .faq-section {
    padding-block: 60px;
  }
  .feature-grid {
    gap: 36px;
    margin-top: 36px;
  }
  .feature-icon {
    margin-bottom: 18px;
  }
  .launch-panel {
    padding: 28px 22px;
    gap: 32px;
  }
  .launch-info {
    border-left: 0;
    border-top: 1px solid var(--border-warm);
    padding: 24px 0 0;
  }
  .launch-symbol {
    display: none;
  }
  .launch-panel .button {
    font-size: 13px;
  }
  .faq-section {
    gap: 12px;
  }
  .closing-section {
    padding-bottom: 56px;
  }
  .landing-footer {
    gap: 8px 24px;
    padding-block: 24px;
  }
  .landing-footer p {
    flex-basis: 100%;
    margin-block: 12px;
  }
}
</style>
