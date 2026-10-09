<script setup lang="ts">
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  BriefcaseBusiness,
  UserRound,
  Users,
  Vote,
} from '@lucide/vue';
import { useWorkspace } from '../state/workspace';
const state = useWorkspace();
</script>

<template>
  <div class="home-page">
    <section class="home-hero" aria-labelledby="home-title">
      <div class="home-intro">
        <p class="eyebrow">GOVERN TOGETHER</p>
        <h1 id="home-title">A home for your <span>community.</span></h1>
        <p class="home-lead">
          Bring your people together to make decisions, organise work and manage shared resources.
        </p>
        <div class="home-actions">
          <RouterLink class="button" :to="state.account ? '/hub?mine=1' : '/hub'">
            {{ state.account ? 'Open my DAOs' : 'Explore DAOs' }}<ArrowRight aria-hidden="true" />
          </RouterLink>
          <RouterLink class="button secondary" to="/create">Create a DAO</RouterLink>
        </div>
        <p class="home-note">
          {{
            state.account
              ? 'You’re signed in. Open your communities to pick up where you left off.'
              : 'Explore freely. Sign in when you’re ready to participate.'
          }}
        </p>
      </div>
      <div class="home-art" aria-hidden="true">
        <div class="home-orbit">
          <svg viewBox="0 0 360 360" fill="none">
            <circle cx="180" cy="180" r="112" />
            <circle cx="180" cy="180" r="153" stroke-dasharray="3 10" />
            <path d="M80 78L180 180L296 120M180 180L174 298" />
          </svg>
          <span class="home-orbit-brand">d.</span>
          <span class="home-orbit-node people"><Users />People</span>
          <span class="home-orbit-node decisions"><Vote />Decisions</span>
          <span class="home-orbit-node work"><BriefcaseBusiness />Work</span>
        </div>
        <p>Good ideas become shared action.</p>
      </div>
    </section>

    <section aria-labelledby="home-next-title">
      <div class="home-section-heading">
        <h2 id="home-next-title">Start where you are.</h2>
        <p>A few essentials to help you find your way.</p>
      </div>
      <div class="home-paths">
        <RouterLink to="/modules" class="home-path panel">
          <span class="home-path-icon"><Blocks aria-hidden="true" /></span>
          <h3>Tools that fit your DAO <ArrowUpRight aria-hidden="true" /></h3>
          <p>
            Explore tools for voting, contributions and funding. Choose what your community needs.
          </p>
          <span class="home-path-action">Explore modules <ArrowRight aria-hidden="true" /></span>
        </RouterLink>
        <RouterLink :to="state.account ? '/users/me' : '/account'" class="home-path panel">
          <span class="home-path-icon"><UserRound aria-hidden="true" /></span>
          <h3>
            {{ state.account ? 'Your account' : 'Set up your account' }}
            <ArrowUpRight aria-hidden="true" />
          </h3>
          <p>
            {{
              state.account
                ? 'Make your profile yours, connect your sign-in methods and keep your recovery kit safe.'
                : 'Create your Daclify account or sign in with a method you’ve already paired. No blockchain account is needed to get started.'
            }}
          </p>
          <span class="home-path-action"
            >{{ state.account ? 'Open your profile' : 'Get started' }}
            <ArrowRight aria-hidden="true"
          /></span>
        </RouterLink>
        <RouterLink to="/docs" class="home-path panel">
          <span class="home-path-icon"><BookOpen aria-hidden="true" /></span>
          <h3>Get a little guidance <ArrowUpRight aria-hidden="true" /></h3>
          <p>
            Learn how accounts, DAO membership and governance work. Practical guides, at your pace.
          </p>
          <span class="home-path-action">Read the handbook <ArrowRight aria-hidden="true" /></span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  display: grid;
  gap: 40px;
}
.home-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  align-items: center;
  gap: 32px;
  padding: clamp(28px, 4vw, 56px);
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  box-shadow: var(--elevation-panel);
}
.home-intro h1 {
  font-size: clamp(36px, 4.5vw, 62px);
  line-height: 1.08;
  letter-spacing: -2px;
  max-width: 620px;
  margin: 16px 0 22px;
}
.home-intro h1 span {
  color: var(--accent-amber);
}
.home-lead {
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1.7;
  max-width: 520px;
}
.home-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 30px;
}
.home-actions svg,
.home-path-action svg {
  width: 18px;
  height: 18px;
}
.home-note {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
  margin: 18px 0 0;
}
.home-art {
  text-align: center;
  min-width: 0;
}
.home-art > p {
  color: var(--text-muted);
  font-size: 13px;
}
.home-orbit {
  position: relative;
  width: 100%;
  max-width: 360px;
  aspect-ratio: 1;
  margin: auto;
}
.home-orbit > svg {
  width: 100%;
  height: 100%;
  stroke: var(--border-warm);
  stroke-width: 1;
}
.home-orbit-brand {
  position: absolute;
  inset: 35%;
  display: grid;
  place-items: center;
  background: var(--surface-brand);
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-lg);
  color: var(--accent-amber);
  font-size: clamp(36px, 4vw, 64px);
  font-weight: 800;
  letter-spacing: -4px;
  padding-right: 5px;
}
.home-orbit-node {
  position: absolute;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--border-warm);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}
.home-orbit-node svg {
  width: 20px;
  height: 20px;
  color: var(--accent-amber);
}
.home-orbit-node.people {
  top: 14%;
  left: 0;
}
.home-orbit-node.decisions {
  top: 28%;
  right: 0;
}
.home-orbit-node.work {
  bottom: 12%;
  left: 35%;
}
.home-section-heading {
  margin: 0 0 22px;
}
.home-section-heading h2 {
  font-size: 25px;
  margin: 0 0 8px;
  letter-spacing: -0.7px;
}
.home-section-heading p {
  color: var(--text-muted);
  margin: 0;
}
.home-paths {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.home-path {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 26px;
  color: var(--text-primary);
  transition:
    border-color var(--motion-fast),
    background-color var(--motion-fast);
}
.home-path:hover {
  background: var(--surface-raised);
  border-color: var(--border-warm);
  text-decoration: none;
}
.home-path-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  color: var(--accent-amber);
  background: var(--surface-brand);
  border-radius: var(--radius-md);
}
.home-path-icon svg {
  width: 24px;
  height: 24px;
}
.home-path h3 {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  font-size: 18px;
  line-height: 1.5;
  margin: 0;
}
.home-path h3 svg {
  width: 18px;
  height: 18px;
  flex: none;
  margin-top: 4px;
  color: var(--text-muted);
}
.home-path p {
  color: var(--text-muted);
  line-height: 1.7;
  font-size: 14px;
  margin: 0;
}
.home-path-action {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent-amber);
  font-size: 13px;
  font-weight: 650;
  margin-top: auto;
  padding-top: 4px;
}
@media (max-width: 1100px) {
  .home-hero {
    gap: 16px;
  }
  .home-orbit-node {
    padding: 10px;
    font-size: 12px;
  }
  .home-paths {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 650px) {
  .home-hero {
    grid-template-columns: 1fr;
    padding: 26px 22px;
  }
  .home-intro h1 {
    font-size: clamp(36px, 8vw, 48px);
    letter-spacing: -1.5px;
  }
  .home-lead {
    font-size: 16px;
  }
  .home-orbit {
    max-width: 260px;
  }
  .home-orbit-brand {
    font-size: 48px;
  }
  .home-art > p {
    margin-bottom: 0;
  }
  .home-path {
    padding: 22px;
  }
}
</style>
