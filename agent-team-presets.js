/**
 * agent-team-presets.js — Team preset definitions
 *
 * Each preset defines agents, initial tasks, message templates,
 * task templates, and component keywords for the simulator.
 */

'use strict';

// ── Dev Team (default) ────────────────────────────────────────────────────
const devTeam = {
  id: 'dev-team',
  name: 'Dev Team',
  description: 'Software development team with frontend, backend, testing, and research agents',
  agents: [
    {
      id: 'agent-orchestrator',
      role: 'lead',
      name: 'Orchestrator',
      description: 'Plans and delegates work across the team',
      color: '#a78bfa',
      position: { x: 50, y: 50 },
    },
    {
      id: 'agent-frontend',
      role: 'teammate',
      name: 'Frontend Agent',
      description: 'Builds UI components and pages',
      color: '#58a6ff',
      position: { x: 20, y: 20 },
    },
    {
      id: 'agent-backend',
      role: 'teammate',
      name: 'Backend Agent',
      description: 'Implements APIs and server logic',
      color: '#3fb950',
      position: { x: 80, y: 20 },
    },
    {
      id: 'agent-testing',
      role: 'teammate',
      name: 'Testing Agent',
      description: 'Writes and runs tests for all modules',
      color: '#f0883e',
      position: { x: 20, y: 80 },
    },
    {
      id: 'agent-research',
      role: 'teammate',
      name: 'Research Agent',
      description: 'Investigates approaches and best practices',
      color: '#f85149',
      position: { x: 80, y: 80 },
    },
  ],
  taskTemplates: [
    'Implement user authentication flow',
    'Build REST API for /api/users',
    'Write unit tests for auth module',
    'Research OAuth2 provider options',
    'Create login page component',
    'Set up database migrations',
    'Configure CI/CD pipeline',
    'Add error handling middleware',
    'Implement WebSocket real-time updates',
    'Design database schema',
  ],
  messageTemplates: [
    { from: 'lead', tmpl: 'Please start working on: {task}' },
    { from: 'any',  tmpl: 'Making progress on {task} — about {pct}% done' },
    { from: 'any',  tmpl: 'Finished {task}. Ready for review.' },
    { from: 'any',  tmpl: 'Found an issue with {component}, investigating...' },
    { from: 'lead', tmpl: 'Team sync: {done} tasks done, {remaining} remaining' },
  ],
  components: [
    'auth module', 'database layer', 'API router',
    'WebSocket handler', 'UI component', 'config parser',
  ],
  initialTasks: [
    'Implement user authentication flow',
    'Build REST API for /api/users',
    'Create login page component',
    'Write unit tests for auth module',
  ],
};

// ── Marketing Team (course sales) ─────────────────────────────────────────
const marketingTeam = {
  id: 'marketing-team',
  name: 'Marketing Team',
  description: 'Marketing team for enterprise course sales — content, ads, SEO, social, email, analytics',
  agents: [
    {
      id: 'agent-marketing-lead',
      role: 'lead',
      name: 'Marketing Lead',
      description: 'Plans campaigns and coordinates the marketing team',
      color: '#a78bfa',
      position: { x: 50, y: 15 },
    },
    {
      id: 'agent-content-writer',
      role: 'teammate',
      name: 'Content Writer',
      description: 'Writes blog posts, landing pages, and email copy',
      color: '#58a6ff',
      position: { x: 15, y: 40 },
    },
    {
      id: 'agent-seo',
      role: 'teammate',
      name: 'SEO Specialist',
      description: 'Optimizes keywords, on-page SEO, and search rankings',
      color: '#3fb950',
      position: { x: 85, y: 40 },
    },
    {
      id: 'agent-social-media',
      role: 'teammate',
      name: 'Social Media',
      description: 'Manages social channels, schedules posts, engages audience',
      color: '#f0883e',
      position: { x: 15, y: 75 },
    },
    {
      id: 'agent-ad-campaign',
      role: 'teammate',
      name: 'Ad Campaign',
      description: 'Runs Facebook & Google Ads, manages budget and targeting',
      color: '#f85149',
      position: { x: 50, y: 55 },
    },
    {
      id: 'agent-email-marketing',
      role: 'teammate',
      name: 'Email Marketing',
      description: 'Builds email sequences, nurture flows, and drip campaigns',
      color: '#d2a8ff',
      position: { x: 85, y: 75 },
    },
    {
      id: 'agent-analytics',
      role: 'teammate',
      name: 'Analytics',
      description: 'Tracks KPIs, conversion rates, and ROI reporting',
      color: '#79c0ff',
      position: { x: 50, y: 90 },
    },
  ],
  taskTemplates: [
    'Write blog post: "Top 10 skills every enterprise team needs"',
    'Create landing page for Leadership course',
    'Optimize SEO for course catalog pages',
    'Research competitor keyword rankings',
    'Design Facebook ad creatives for Q2 campaign',
    'Set up Google Ads campaign for B2B courses',
    'Build email nurture sequence for trial users',
    'Schedule social media posts for course launch',
    'Create LinkedIn carousel about team training ROI',
    'Analyze last month conversion funnel',
    'A/B test email subject lines for open rate',
    'Write case study: enterprise client success story',
    'Set up retargeting audience for abandoned carts',
    'Create webinar registration landing page',
    'Build referral program email flow',
    'Audit website Core Web Vitals for SEO',
    'Design Instagram Reels for course highlights',
    'Write press release for new course launch',
    'Set up UTM tracking for all campaign links',
    'Prepare monthly marketing performance report',
  ],
  messageTemplates: [
    { from: 'lead', tmpl: 'New campaign brief: {task}. Let\'s prioritize this.' },
    { from: 'lead', tmpl: 'Team sync: {done} tasks done, {remaining} remaining. Keep pushing!' },
    { from: 'lead', tmpl: 'Great progress on {task}. What\'s the ETA?' },
    { from: 'any',  tmpl: 'Working on {task} — about {pct}% done' },
    { from: 'any',  tmpl: 'Finished {task}. Ready for review.' },
    { from: 'any',  tmpl: 'Found an issue with {component}, need to fix before launch.' },
    { from: 'any',  tmpl: 'The {component} numbers look promising — CTR up 12%!' },
    { from: 'any',  tmpl: 'Need copy from Content Writer for {component} campaign.' },
    { from: 'any',  tmpl: 'SEO audit shows we should target more long-tail keywords.' },
    { from: 'any',  tmpl: 'Email open rate hit 32% on the latest sequence!' },
    { from: 'any',  tmpl: 'Ad spend is on track — CPA at $18 for B2B leads.' },
    { from: 'any',  tmpl: 'Social engagement up 25% this week. LinkedIn performing best.' },
  ],
  components: [
    'landing page', 'email sequence', 'ad creative',
    'blog content', 'social calendar', 'analytics dashboard',
    'lead magnet', 'conversion funnel', 'SEO meta tags',
    'retargeting pixel', 'UTM tracking', 'CTA button',
  ],
  initialTasks: [
    'Write blog post: "Top 10 skills every enterprise team needs"',
    'Create landing page for Leadership course',
    'Design Facebook ad creatives for Q2 campaign',
    'Build email nurture sequence for trial users',
    'Schedule social media posts for course launch',
    'Analyze last month conversion funnel',
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────
const PRESETS = new Map([
  [devTeam.id, devTeam],
  [marketingTeam.id, marketingTeam],
]);

function getPreset(id) {
  return PRESETS.get(id) || null;
}

function listPresets() {
  return [...PRESETS.values()].map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    agentCount: p.agents.length,
  }));
}

module.exports = { PRESETS, getPreset, listPresets, devTeam, marketingTeam };
