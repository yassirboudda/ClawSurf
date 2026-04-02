#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   AMI Browser – Standalone Gateway
   Run this alongside the AMI Browser.
   Provides: HTTP health + /api/chat + /api/cron, WS relay, MCP server
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/* ── State ── */
let wsServer = null;
let mcpProcess = null;
const connectedClients = new Set();
const chatHistory = [];

/* ── Connections persistence ── */
const CONNECTIONS_FILE = path.join(__dirname, '.connections.json');
let savedConnections = [];
try {
  if (fs.existsSync(CONNECTIONS_FILE)) {
    savedConnections = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8'));
  }
} catch { savedConnections = []; }

function persistConnections() {
  try { fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(savedConnections, null, 2)); } catch {}
}

/* ── Secret encryption (AES-256-GCM) ── */
const ENC_KEY_FILE = path.join(__dirname, '.enc_key');
let ENC_KEY;
try {
  if (fs.existsSync(ENC_KEY_FILE)) {
    ENC_KEY = Buffer.from(fs.readFileSync(ENC_KEY_FILE, 'utf8').trim(), 'hex');
  } else {
    ENC_KEY = crypto.randomBytes(32);
    fs.writeFileSync(ENC_KEY_FILE, ENC_KEY.toString('hex'), { mode: 0o600 });
  }
} catch { ENC_KEY = crypto.randomBytes(32); }

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${enc}`;
}

function decryptSecret(encrypted) {
  const [ivHex, tagHex, data] = encrypted.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let dec = decipher.update(data, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

/* ── Provider Catalog (for connections page) ── */
const PROVIDER_CATALOG = [
  // ── AI Providers (20) ──
  { id: 'openai',        label: 'OpenAI',              category: 'AI Provider',   kind: 'API Key',   description: 'GPT-4o, GPT-4.1, o3 and more' },
  { id: 'anthropic',     label: 'Anthropic',            category: 'AI Provider',   kind: 'API Key',   description: 'Claude Opus, Sonnet, Haiku' },
  { id: 'gemini',        label: 'Google Gemini',        category: 'AI Provider',   kind: 'API Key',   description: 'Gemini 2.5 Pro, Flash, and more' },
  { id: 'mistral',       label: 'Mistral',              category: 'AI Provider',   kind: 'API Key',   description: 'Mistral Large, Codestral, Voxtral' },
  { id: 'grok',          label: 'xAI Grok',             category: 'AI Provider',   kind: 'API Key',   description: 'Grok-2, Grok-3 models' },
  { id: 'deepseek',      label: 'DeepSeek',             category: 'AI Provider',   kind: 'API Key',   description: 'DeepSeek V3, R1 reasoning' },
  { id: 'openrouter',    label: 'OpenRouter',           category: 'AI Provider',   kind: 'API Key',   description: 'Access 200+ models via one key' },
  { id: 'huggingface',   label: 'HuggingFace',          category: 'AI Provider',   kind: 'API Key',   description: 'Open-source models, inference API' },
  { id: 'ollama',        label: 'Ollama',               category: 'AI Provider',   kind: 'Local',     description: 'Run LLMs locally on your machine' },
  { id: 'together',      label: 'Together AI',          category: 'AI Provider',   kind: 'API Key',   description: 'Fast inference for open-source models' },
  { id: 'replicate',     label: 'Replicate',            category: 'AI Provider',   kind: 'API Key',   description: 'Run ML models with a cloud API' },
  { id: 'perplexity',    label: 'Perplexity',           category: 'AI Provider',   kind: 'API Key',   description: 'Sonar Pro, online search-augmented LLM' },
  { id: 'cohere',        label: 'Cohere',               category: 'AI Provider',   kind: 'API Key',   description: 'Command R+, Embed, Rerank models' },
  { id: 'ai21',          label: 'AI21 Labs',            category: 'AI Provider',   kind: 'API Key',   description: 'Jamba, Jurassic language models' },
  { id: 'fireworks',     label: 'Fireworks AI',         category: 'AI Provider',   kind: 'API Key',   description: 'Fast inference for open models' },
  { id: 'groq',          label: 'Groq',                 category: 'AI Provider',   kind: 'API Key',   description: 'Ultra-fast LPU inference, Llama, Mixtral' },
  { id: 'cerebras',      label: 'Cerebras',             category: 'AI Provider',   kind: 'API Key',   description: 'Wafer-scale fast inference' },
  { id: 'runpod',        label: 'RunPod',               category: 'AI Provider',   kind: 'API Key',   description: 'GPU cloud for AI inference and training' },
  { id: 'custom',        label: 'Custom Endpoint',      category: 'AI Provider',   kind: 'Endpoint',  description: 'Any OpenAI-compatible endpoint' },
  { id: 'lmstudio',      label: 'LM Studio',            category: 'AI Provider',   kind: 'Local',     description: 'Run local models via LM Studio' },
  // ── AI Specialty (15) ──
  { id: 'elevenlabs',    label: 'ElevenLabs',           category: 'AI Specialty',  kind: 'API Key',   description: 'Realistic text-to-speech and voice cloning' },
  { id: 'stability',     label: 'Stability AI',         category: 'AI Specialty',  kind: 'API Key',   description: 'Stable Diffusion image generation' },
  { id: 'midjourney',    label: 'Midjourney',           category: 'AI Specialty',  kind: 'API Key',   description: 'AI image generation via API' },
  { id: 'stt_mistral',   label: 'Mistral Voxtral (STT)',category: 'AI Specialty',  kind: 'API Key',   description: 'Speech-to-text via Mistral Voxtral' },
  { id: 'tts_mistral',   label: 'Mistral TTS',          category: 'AI Specialty',  kind: 'API Key',   description: 'Text-to-speech via Mistral' },
  { id: 'whisper',       label: 'OpenAI Whisper',       category: 'AI Specialty',  kind: 'API Key',   description: 'Speech recognition and transcription' },
  { id: 'deepgram',      label: 'Deepgram',             category: 'AI Specialty',  kind: 'API Key',   description: 'Real-time speech-to-text API' },
  { id: 'assemblyai',    label: 'AssemblyAI',           category: 'AI Specialty',  kind: 'API Key',   description: 'Audio transcription and intelligence' },
  { id: 'langchain',     label: 'LangChain',            category: 'AI Specialty',  kind: 'API Key',   description: 'LangSmith tracing and LangChain hub' },
  { id: 'pinecone',      label: 'Pinecone',             category: 'AI Specialty',  kind: 'API Key',   description: 'Vector database for embeddings' },
  { id: 'weaviate',      label: 'Weaviate',             category: 'AI Specialty',  kind: 'API Key',   description: 'Vector search engine and database' },
  { id: 'qdrant',        label: 'Qdrant',               category: 'AI Specialty',  kind: 'API Key',   description: 'Vector similarity search engine' },
  { id: 'chromadb',      label: 'ChromaDB',             category: 'AI Specialty',  kind: 'Local',     description: 'Open-source embedding database' },
  { id: 'unstructured',  label: 'Unstructured',         category: 'AI Specialty',  kind: 'API Key',   description: 'Document parsing and chunking API' },
  { id: 'voyage',        label: 'Voyage AI',            category: 'AI Specialty',  kind: 'API Key',   description: 'State-of-the-art embedding models' },
  // ── Messaging (10) ──
  { id: 'telegram',      label: 'Telegram Bot',         category: 'Messaging',     kind: 'Bot Token', description: 'Control AMI agent from Telegram' },
  { id: 'discord',       label: 'Discord Bot',          category: 'Messaging',     kind: 'Bot Token', description: 'Control AMI agent from Discord' },
  { id: 'whatsapp',      label: 'WhatsApp',             category: 'Messaging',     kind: 'API Key',   description: 'WhatsApp Business API integration' },
  { id: 'slack',         label: 'Slack',                category: 'Messaging',     kind: 'Bot Token', description: 'Control AMI agent from Slack' },
  { id: 'signal',        label: 'Signal',               category: 'Messaging',     kind: 'API Key',   description: 'Signal messenger integration' },
  { id: 'teams',         label: 'Microsoft Teams',      category: 'Messaging',     kind: 'Webhook',   description: 'Teams incoming webhook integration' },
  { id: 'twilio',        label: 'Twilio',               category: 'Messaging',     kind: 'API Key',   description: 'SMS, voice, and messaging API' },
  { id: 'vonage',        label: 'Vonage',               category: 'Messaging',     kind: 'API Key',   description: 'Communication APIs – SMS, voice, video' },
  { id: 'intercom',      label: 'Intercom',             category: 'Messaging',     kind: 'API Key',   description: 'Customer messaging and support platform' },
  { id: 'crisp',         label: 'Crisp',                category: 'Messaging',     kind: 'API Key',   description: 'Customer messaging and live chat' },
  // ── CRM & Sales (15) ──
  { id: 'salesforce',    label: 'Salesforce',           category: 'CRM & Sales',   kind: 'API Key',   description: 'CRM automation – leads, contacts, pipelines' },
  { id: 'hubspot',       label: 'HubSpot',              category: 'CRM & Sales',   kind: 'API Key',   description: 'Marketing, sales, and service hub API' },
  { id: 'pipedrive',     label: 'Pipedrive',            category: 'CRM & Sales',   kind: 'API Key',   description: 'Sales pipeline and deal management' },
  { id: 'zoho_crm',      label: 'Zoho CRM',             category: 'CRM & Sales',   kind: 'API Key',   description: 'Zoho CRM automation and workflows' },
  { id: 'freshsales',    label: 'Freshsales',           category: 'CRM & Sales',   kind: 'API Key',   description: 'AI-powered CRM for sales teams' },
  { id: 'close',         label: 'Close CRM',            category: 'CRM & Sales',   kind: 'API Key',   description: 'CRM built for inside sales teams' },
  { id: 'copper',        label: 'Copper',               category: 'CRM & Sales',   kind: 'API Key',   description: 'Google Workspace CRM' },
  { id: 'apollo',        label: 'Apollo.io',            category: 'CRM & Sales',   kind: 'API Key',   description: 'Sales intelligence and engagement' },
  { id: 'salesloft',     label: 'SalesLoft',            category: 'CRM & Sales',   kind: 'API Key',   description: 'Sales engagement platform' },
  { id: 'outreach',      label: 'Outreach',             category: 'CRM & Sales',   kind: 'API Key',   description: 'Sales execution platform' },
  { id: 'clearbit',      label: 'Clearbit',             category: 'CRM & Sales',   kind: 'API Key',   description: 'Business intelligence and lead enrichment' },
  { id: 'hunter',        label: 'Hunter.io',            category: 'CRM & Sales',   kind: 'API Key',   description: 'Find and verify email addresses' },
  { id: 'lemlist',       label: 'Lemlist',              category: 'CRM & Sales',   kind: 'API Key',   description: 'Cold email and outreach automation' },
  { id: 'snov',          label: 'Snov.io',              category: 'CRM & Sales',   kind: 'API Key',   description: 'Email finder and outreach tool' },
  { id: 'attio',         label: 'Attio',                category: 'CRM & Sales',   kind: 'API Key',   description: 'Next-gen CRM with relationship intelligence' },
  // ── Payments & Finance (12) ──
  { id: 'stripe',        label: 'Stripe',               category: 'Payments',      kind: 'API Key',   description: 'Payment processing, subscriptions, invoices' },
  { id: 'paypal',        label: 'PayPal',               category: 'Payments',      kind: 'API Key',   description: 'PayPal payments and transfers' },
  { id: 'wise',          label: 'Wise',                 category: 'Payments',      kind: 'API Key',   description: 'International money transfers' },
  { id: 'plaid',         label: 'Plaid',                category: 'Payments',      kind: 'API Key',   description: 'Bank account linking and transaction data' },
  { id: 'square',        label: 'Square',               category: 'Payments',      kind: 'API Key',   description: 'Point-of-sale and payment processing' },
  { id: 'braintree',     label: 'Braintree',            category: 'Payments',      kind: 'API Key',   description: 'Payment gateway by PayPal' },
  { id: 'razorpay',      label: 'Razorpay',             category: 'Payments',      kind: 'API Key',   description: 'Payments for Indian businesses' },
  { id: 'quickbooks',    label: 'QuickBooks',           category: 'Payments',      kind: 'API Key',   description: 'Accounting, invoicing, and bookkeeping' },
  { id: 'xero',          label: 'Xero',                 category: 'Payments',      kind: 'API Key',   description: 'Cloud accounting for small business' },
  { id: 'freshbooks',    label: 'FreshBooks',           category: 'Payments',      kind: 'API Key',   description: 'Invoicing and accounting software' },
  { id: 'wave',          label: 'Wave',                 category: 'Payments',      kind: 'API Key',   description: 'Free invoicing and accounting' },
  { id: 'paddle',        label: 'Paddle',               category: 'Payments',      kind: 'API Key',   description: 'SaaS billing and revenue delivery' },
  // ── DeFi & Web3 (16) ──
  { id: 'arena',         label: 'Arena (app.ami.finance)', category: 'DeFi & Web3', kind: 'API Key', description: 'AMI Finance arena – DeFi actions and portfolio' },
  { id: 'etherscan',     label: 'Etherscan',            category: 'DeFi & Web3',   kind: 'API Key',   description: 'Ethereum blockchain data and analytics' },
  { id: 'alchemy',       label: 'Alchemy',              category: 'DeFi & Web3',   kind: 'API Key',   description: 'Web3 node RPCs, NFT API, transaction API' },
  { id: 'moralis',       label: 'Moralis',              category: 'DeFi & Web3',   kind: 'API Key',   description: 'Web3 data API – tokens, NFTs, DeFi events' },
  { id: 'infura',        label: 'Infura',               category: 'DeFi & Web3',   kind: 'API Key',   description: 'Ethereum and IPFS infrastructure API' },
  { id: 'coingecko',     label: 'CoinGecko',            category: 'DeFi & Web3',   kind: 'API Key',   description: 'Crypto price feeds, market data, and charts' },
  { id: 'coinmarketcap', label: 'CoinMarketCap',        category: 'DeFi & Web3',   kind: 'API Key',   description: 'Crypto market cap rankings, price data' },
  { id: 'walletconnect', label: 'WalletConnect',        category: 'DeFi & Web3',   kind: 'Project ID',description: 'Connect to crypto wallets' },
  { id: 'thegraph',      label: 'The Graph',            category: 'DeFi & Web3',   kind: 'API Key',   description: 'Query on-chain data via subgraphs' },
  { id: 'dune',          label: 'Dune Analytics',       category: 'DeFi & Web3',   kind: 'API Key',   description: 'SQL-based on-chain analytics and dashboards' },
  { id: 'oneinch',       label: '1inch',                category: 'DeFi & Web3',   kind: 'API Key',   description: 'DEX aggregation and swap routing' },
  { id: 'bscscan',       label: 'BscScan',              category: 'DeFi & Web3',   kind: 'API Key',   description: 'BNB Chain blockchain explorer' },
  { id: 'polygonscan',   label: 'PolygonScan',          category: 'DeFi & Web3',   kind: 'API Key',   description: 'Polygon blockchain explorer' },
  { id: 'arbiscan',      label: 'Arbiscan',             category: 'DeFi & Web3',   kind: 'API Key',   description: 'Arbitrum blockchain explorer' },
  { id: 'debank',        label: 'DeBank',               category: 'DeFi & Web3',   kind: 'API Key',   description: 'Multi-chain DeFi portfolio tracker' },
  { id: 'zapper',        label: 'Zapper',               category: 'DeFi & Web3',   kind: 'API Key',   description: 'DeFi dashboard and portfolio tracker' },
  // ── Project Management (14) ──
  { id: 'jira',          label: 'Jira',                 category: 'Project Mgmt',  kind: 'API Key',   description: 'Issue tracking and project management' },
  { id: 'linear',        label: 'Linear',               category: 'Project Mgmt',  kind: 'API Key',   description: 'Modern issue tracking for software teams' },
  { id: 'asana',         label: 'Asana',                category: 'Project Mgmt',  kind: 'API Key',   description: 'Work management and team collaboration' },
  { id: 'monday',        label: 'Monday.com',           category: 'Project Mgmt',  kind: 'API Key',   description: 'Work OS for team workflows' },
  { id: 'trello',        label: 'Trello',               category: 'Project Mgmt',  kind: 'API Key',   description: 'Kanban boards and task management' },
  { id: 'clickup',       label: 'ClickUp',              category: 'Project Mgmt',  kind: 'API Key',   description: 'All-in-one productivity platform' },
  { id: 'basecamp',      label: 'Basecamp',             category: 'Project Mgmt',  kind: 'API Key',   description: 'Project management and team communication' },
  { id: 'todoist',       label: 'Todoist',              category: 'Project Mgmt',  kind: 'API Key',   description: 'Task management and to-do lists' },
  { id: 'height',        label: 'Height',               category: 'Project Mgmt',  kind: 'API Key',   description: 'Autonomous project management with AI' },
  { id: 'shortcut',      label: 'Shortcut',             category: 'Project Mgmt',  kind: 'API Key',   description: 'Project management for dev teams' },
  { id: 'wrike',         label: 'Wrike',                category: 'Project Mgmt',  kind: 'API Key',   description: 'Enterprise work management platform' },
  { id: 'teamwork',      label: 'Teamwork',             category: 'Project Mgmt',  kind: 'API Key',   description: 'Client work management platform' },
  { id: 'smartsheet',    label: 'Smartsheet',           category: 'Project Mgmt',  kind: 'API Key',   description: 'Spreadsheet-like project management' },
  { id: 'notion',        label: 'Notion',               category: 'Project Mgmt',  kind: 'API Key',   description: 'Notion pages, databases, and blocks API' },
  // ── Cloud & DevOps (18) ──
  { id: 'github',        label: 'GitHub',               category: 'Cloud & DevOps', kind: 'PAT Token', description: 'Repository and CI/CD automation' },
  { id: 'gitlab',        label: 'GitLab',               category: 'Cloud & DevOps', kind: 'PAT Token', description: 'DevSecOps platform and CI/CD' },
  { id: 'bitbucket',     label: 'Bitbucket',            category: 'Cloud & DevOps', kind: 'App Password', description: 'Git platform by Atlassian' },
  { id: 'vercel',        label: 'Vercel',               category: 'Cloud & DevOps', kind: 'API Key',   description: 'Frontend deployment and serverless functions' },
  { id: 'netlify',       label: 'Netlify',              category: 'Cloud & DevOps', kind: 'API Key',   description: 'Web platform for modern development' },
  { id: 'cloudflare',    label: 'Cloudflare',           category: 'Cloud & DevOps', kind: 'API Key',   description: 'CDN, DNS, Workers, and edge computing' },
  { id: 'aws',           label: 'AWS',                  category: 'Cloud & DevOps', kind: 'API Key',   description: 'Amazon Web Services – S3, Lambda, EC2, etc.' },
  { id: 'gcp',           label: 'Google Cloud',         category: 'Cloud & DevOps', kind: 'API Key',   description: 'Google Cloud Platform services' },
  { id: 'azure',         label: 'Microsoft Azure',      category: 'Cloud & DevOps', kind: 'API Key',   description: 'Azure cloud services and compute' },
  { id: 'digitalocean',  label: 'DigitalOcean',         category: 'Cloud & DevOps', kind: 'API Key',   description: 'Cloud infrastructure for developers' },
  { id: 'docker',        label: 'Docker Hub',           category: 'Cloud & DevOps', kind: 'PAT Token', description: 'Container registry and Docker images' },
  { id: 'railway',       label: 'Railway',              category: 'Cloud & DevOps', kind: 'API Key',   description: 'Deploy apps and databases instantly' },
  { id: 'render',        label: 'Render',               category: 'Cloud & DevOps', kind: 'API Key',   description: 'Cloud hosting for web apps and services' },
  { id: 'fly',           label: 'Fly.io',               category: 'Cloud & DevOps', kind: 'API Key',   description: 'Deploy apps close to users globally' },
  { id: 'datadog',       label: 'Datadog',              category: 'Cloud & DevOps', kind: 'API Key',   description: 'Monitoring, APM, and log management' },
  { id: 'pagerduty',     label: 'PagerDuty',            category: 'Cloud & DevOps', kind: 'API Key',   description: 'Incident management and alerting' },
  { id: 'sentry',        label: 'Sentry',               category: 'Cloud & DevOps', kind: 'API Key',   description: 'Application error monitoring and tracking' },
  { id: 'grafana',       label: 'Grafana Cloud',        category: 'Cloud & DevOps', kind: 'API Key',   description: 'Observability, dashboards, and alerting' },
  // ── Database & Storage (14) ──
  { id: 'supabase',      label: 'Supabase',             category: 'Database',      kind: 'API Key',   description: 'Postgres, auth, storage, edge functions' },
  { id: 'firebase',      label: 'Firebase',             category: 'Database',      kind: 'API Key',   description: 'Google Firebase – Firestore, Auth, Functions' },
  { id: 'mongodb',       label: 'MongoDB Atlas',        category: 'Database',      kind: 'API Key',   description: 'MongoDB cloud database and data API' },
  { id: 'planetscale',   label: 'PlanetScale',          category: 'Database',      kind: 'API Key',   description: 'Serverless MySQL platform' },
  { id: 'neon',          label: 'Neon',                 category: 'Database',      kind: 'API Key',   description: 'Serverless Postgres with branching' },
  { id: 'redis',         label: 'Redis (Upstash)',      category: 'Database',      kind: 'API Key',   description: 'Serverless Redis and Kafka' },
  { id: 'elasticsearch', label: 'Elasticsearch',        category: 'Database',      kind: 'API Key',   description: 'Search and analytics engine' },
  { id: 'algolia',       label: 'Algolia',              category: 'Database',      kind: 'API Key',   description: 'Search and discovery API' },
  { id: 'airtable',      label: 'Airtable',             category: 'Database',      kind: 'API Key',   description: 'Spreadsheet-database hybrid' },
  { id: 'fauna',         label: 'Fauna',                category: 'Database',      kind: 'API Key',   description: 'Distributed serverless database' },
  { id: 'cockroachdb',   label: 'CockroachDB',          category: 'Database',      kind: 'API Key',   description: 'Distributed SQL database' },
  { id: 'turso',         label: 'Turso',                category: 'Database',      kind: 'API Key',   description: 'Edge SQLite database' },
  { id: 'convex',        label: 'Convex',               category: 'Database',      kind: 'API Key',   description: 'Reactive backend-as-a-service' },
  { id: 'appwrite',      label: 'Appwrite',             category: 'Database',      kind: 'API Key',   description: 'Open-source backend server' },
  // ── Email & Marketing (12) ──
  { id: 'sendgrid',      label: 'SendGrid',             category: 'Email',         kind: 'API Key',   description: 'Transactional and marketing emails' },
  { id: 'mailchimp',     label: 'Mailchimp',            category: 'Email',         kind: 'API Key',   description: 'Email campaigns and audience management' },
  { id: 'resend',        label: 'Resend',               category: 'Email',         kind: 'API Key',   description: 'Developer-first email API' },
  { id: 'mailgun',       label: 'Mailgun',              category: 'Email',         kind: 'API Key',   description: 'Email API for sending and receiving' },
  { id: 'postmark',      label: 'Postmark',             category: 'Email',         kind: 'API Key',   description: 'Fast reliable transactional email' },
  { id: 'convertkit',    label: 'ConvertKit',           category: 'Email',         kind: 'API Key',   description: 'Email marketing for creators' },
  { id: 'brevo',         label: 'Brevo (Sendinblue)',   category: 'Email',         kind: 'API Key',   description: 'Email, SMS, and marketing automation' },
  { id: 'activecampaign',label: 'ActiveCampaign',       category: 'Email',         kind: 'API Key',   description: 'Email marketing and CRM automation' },
  { id: 'klaviyo',       label: 'Klaviyo',              category: 'Email',         kind: 'API Key',   description: 'E-commerce email and SMS marketing' },
  { id: 'beehiiv',       label: 'Beehiiv',              category: 'Email',         kind: 'API Key',   description: 'Newsletter platform for creators' },
  { id: 'loops',         label: 'Loops',                category: 'Email',         kind: 'API Key',   description: 'Email for SaaS companies' },
  { id: 'customerio',    label: 'Customer.io',          category: 'Email',         kind: 'API Key',   description: 'Automated messaging platform' },
  // ── E-Commerce (10) ──
  { id: 'shopify',       label: 'Shopify',              category: 'E-Commerce',    kind: 'API Key',   description: 'E-commerce platform – products, orders, inventory' },
  { id: 'woocommerce',   label: 'WooCommerce',          category: 'E-Commerce',    kind: 'API Key',   description: 'WordPress e-commerce plugin API' },
  { id: 'bigcommerce',   label: 'BigCommerce',          category: 'E-Commerce',    kind: 'API Key',   description: 'Enterprise e-commerce platform' },
  { id: 'magento',       label: 'Magento (Adobe)',      category: 'E-Commerce',    kind: 'API Key',   description: 'Open-source e-commerce platform' },
  { id: 'gumroad',       label: 'Gumroad',              category: 'E-Commerce',    kind: 'API Key',   description: 'Sell digital products and memberships' },
  { id: 'lemonsqueezy',  label: 'Lemon Squeezy',        category: 'E-Commerce',    kind: 'API Key',   description: 'Payments, tax, and subscriptions for SaaS' },
  { id: 'printful',      label: 'Printful',             category: 'E-Commerce',    kind: 'API Key',   description: 'Print-on-demand and fulfillment' },
  { id: 'shipstation',   label: 'ShipStation',          category: 'E-Commerce',    kind: 'API Key',   description: 'Shipping and order fulfillment' },
  { id: 'aftership',     label: 'AfterShip',            category: 'E-Commerce',    kind: 'API Key',   description: 'Shipment tracking and notifications' },
  { id: 'snipcart',      label: 'Snipcart',             category: 'E-Commerce',    kind: 'API Key',   description: 'Shopping cart for any website' },
  // ── Social Media (12) ──
  { id: 'twitter',       label: 'Twitter / X',          category: 'Social Media',  kind: 'API Key',   description: 'Post tweets, read feeds, manage DMs' },
  { id: 'linkedin',      label: 'LinkedIn',             category: 'Social Media',  kind: 'API Key',   description: 'Professional network – posts, profiles, messaging' },
  { id: 'facebook',      label: 'Meta (Facebook)',      category: 'Social Media',  kind: 'API Key',   description: 'Facebook pages, ads, and insights' },
  { id: 'instagram',     label: 'Instagram',            category: 'Social Media',  kind: 'API Key',   description: 'Instagram posts, stories, and insights' },
  { id: 'tiktok',        label: 'TikTok',               category: 'Social Media',  kind: 'API Key',   description: 'TikTok for Business API' },
  { id: 'youtube',       label: 'YouTube',              category: 'Social Media',  kind: 'API Key',   description: 'YouTube Data API – videos, channels, analytics' },
  { id: 'pinterest',     label: 'Pinterest',            category: 'Social Media',  kind: 'API Key',   description: 'Pinterest pins, boards, and ads' },
  { id: 'reddit',        label: 'Reddit',               category: 'Social Media',  kind: 'API Key',   description: 'Reddit API – posts, comments, subreddits' },
  { id: 'mastodon',      label: 'Mastodon',             category: 'Social Media',  kind: 'API Key',   description: 'Fediverse social network integration' },
  { id: 'bluesky',       label: 'Bluesky',              category: 'Social Media',  kind: 'API Key',   description: 'Bluesky AT Protocol social network' },
  { id: 'buffer',        label: 'Buffer',               category: 'Social Media',  kind: 'API Key',   description: 'Social media scheduling and analytics' },
  { id: 'hootsuite',     label: 'Hootsuite',            category: 'Social Media',  kind: 'API Key',   description: 'Social media management platform' },
  // ── Advertising (8) ──
  { id: 'google_ads',    label: 'Google Ads',           category: 'Advertising',   kind: 'API Key',   description: 'Search, display, and YouTube ads' },
  { id: 'facebook_ads',  label: 'Meta Ads',             category: 'Advertising',   kind: 'API Key',   description: 'Facebook and Instagram advertising' },
  { id: 'tiktok_ads',    label: 'TikTok Ads',           category: 'Advertising',   kind: 'API Key',   description: 'TikTok advertising and campaign management' },
  { id: 'snapchat_ads',  label: 'Snapchat Ads',         category: 'Advertising',   kind: 'API Key',   description: 'Snapchat advertising platform' },
  { id: 'microsoft_ads', label: 'Microsoft Ads',        category: 'Advertising',   kind: 'API Key',   description: 'Bing search and display ads' },
  { id: 'linkedin_ads',  label: 'LinkedIn Ads',         category: 'Advertising',   kind: 'API Key',   description: 'B2B advertising on LinkedIn' },
  { id: 'google_analytics', label: 'Google Analytics',  category: 'Advertising',   kind: 'API Key',   description: 'Web analytics and reporting' },
  { id: 'mixpanel',      label: 'Mixpanel',             category: 'Advertising',   kind: 'API Key',   description: 'Product analytics and user behavior' },
  // ── Customer Support (8) ──
  { id: 'zendesk',       label: 'Zendesk',              category: 'Support',       kind: 'API Key',   description: 'Customer support and ticketing' },
  { id: 'freshdesk',     label: 'Freshdesk',            category: 'Support',       kind: 'API Key',   description: 'Helpdesk and customer support' },
  { id: 'helpscout',     label: 'Help Scout',           category: 'Support',       kind: 'API Key',   description: 'Customer service platform' },
  { id: 'drift',         label: 'Drift',                category: 'Support',       kind: 'API Key',   description: 'Conversational marketing and sales' },
  { id: 'tawk',          label: 'Tawk.to',              category: 'Support',       kind: 'API Key',   description: 'Free live chat software' },
  { id: 'front',         label: 'Front',                category: 'Support',       kind: 'API Key',   description: 'Shared inbox for teams' },
  { id: 'dixa',          label: 'Dixa',                 category: 'Support',       kind: 'API Key',   description: 'Customer service platform' },
  { id: 'gladly',        label: 'Gladly',               category: 'Support',       kind: 'API Key',   description: 'People-centered customer service' },
  // ── CMS & Website Builders (10) ──
  { id: 'wordpress',     label: 'WordPress',            category: 'CMS',           kind: 'API Key',   description: 'WordPress REST API for posts and pages' },
  { id: 'webflow',       label: 'Webflow',              category: 'CMS',           kind: 'API Key',   description: 'Visual web design and CMS' },
  { id: 'ghost',         label: 'Ghost',                category: 'CMS',           kind: 'API Key',   description: 'Publishing platform for content creators' },
  { id: 'contentful',    label: 'Contentful',           category: 'CMS',           kind: 'API Key',   description: 'Headless CMS for digital content' },
  { id: 'sanity',        label: 'Sanity',               category: 'CMS',           kind: 'API Key',   description: 'Structured content platform' },
  { id: 'strapi',        label: 'Strapi',               category: 'CMS',           kind: 'API Key',   description: 'Open-source headless CMS' },
  { id: 'medium',        label: 'Medium',               category: 'CMS',           kind: 'API Key',   description: 'Publishing platform integration' },
  { id: 'substack',      label: 'Substack',             category: 'CMS',           kind: 'API Key',   description: 'Newsletter and subscription publishing' },
  { id: 'bubble',        label: 'Bubble',               category: 'CMS',           kind: 'API Key',   description: 'No-code web app builder' },
  { id: 'retool',        label: 'Retool',               category: 'CMS',           kind: 'API Key',   description: 'Build internal tools fast' },
  // ── Productivity & Docs (10) ──
  { id: 'google_sheets', label: 'Google Sheets',        category: 'Productivity',  kind: 'OAuth',     description: 'Read/write Google Sheets data' },
  { id: 'google_drive',  label: 'Google Drive',         category: 'Productivity',  kind: 'OAuth',     description: 'File storage and sharing' },
  { id: 'google_calendar', label: 'Google Calendar',    category: 'Productivity',  kind: 'OAuth',     description: 'Calendar events and scheduling' },
  { id: 'google_docs',   label: 'Google Docs',          category: 'Productivity',  kind: 'OAuth',     description: 'Document editing and collaboration' },
  { id: 'dropbox',       label: 'Dropbox',              category: 'Productivity',  kind: 'API Key',   description: 'Cloud file storage and sharing' },
  { id: 'box',           label: 'Box',                  category: 'Productivity',  kind: 'API Key',   description: 'Enterprise content management' },
  { id: 'onedrive',      label: 'OneDrive',             category: 'Productivity',  kind: 'OAuth',     description: 'Microsoft cloud file storage' },
  { id: 'confluence',    label: 'Confluence',           category: 'Productivity',  kind: 'API Key',   description: 'Team documentation and knowledge base' },
  { id: 'coda',          label: 'Coda',                 category: 'Productivity',  kind: 'API Key',   description: 'All-in-one collaborative document' },
  { id: 'calendly',      label: 'Calendly',             category: 'Productivity',  kind: 'API Key',   description: 'Scheduling and appointment management' },
  // ── HR & Recruiting (6) ──
  { id: 'bamboohr',      label: 'BambooHR',             category: 'HR',            kind: 'API Key',   description: 'HR management and employee data' },
  { id: 'greenhouse',    label: 'Greenhouse',           category: 'HR',            kind: 'API Key',   description: 'Recruiting and hiring platform' },
  { id: 'lever',         label: 'Lever',                category: 'HR',            kind: 'API Key',   description: 'Talent acquisition platform' },
  { id: 'workday',       label: 'Workday',              category: 'HR',            kind: 'API Key',   description: 'Enterprise HR and finance platform' },
  { id: 'gusto',         label: 'Gusto',                category: 'HR',            kind: 'API Key',   description: 'Payroll and HR for small businesses' },
  { id: 'rippling',      label: 'Rippling',             category: 'HR',            kind: 'API Key',   description: 'HR, IT, and finance all-in-one' },
  // ── Forms & Surveys (6) ──
  { id: 'typeform',      label: 'Typeform',             category: 'Forms',         kind: 'API Key',   description: 'Conversational forms and surveys' },
  { id: 'google_forms',  label: 'Google Forms',         category: 'Forms',         kind: 'OAuth',     description: 'Free survey and form builder' },
  { id: 'jotform',       label: 'JotForm',              category: 'Forms',         kind: 'API Key',   description: 'Online form builder' },
  { id: 'tally',         label: 'Tally',                category: 'Forms',         kind: 'API Key',   description: 'Free form builder for creators' },
  { id: 'surveymonkey',  label: 'SurveyMonkey',         category: 'Forms',         kind: 'API Key',   description: 'Survey and feedback platform' },
  { id: 'formbricks',    label: 'Formbricks',           category: 'Forms',         kind: 'API Key',   description: 'Open-source survey and feedback tool' },
  // ── ERP & Business (6) ──
  { id: 'odoo',          label: 'Odoo',                 category: 'ERP',           kind: 'API Key',   description: 'Open-source ERP and business apps' },
  { id: 'sap',           label: 'SAP',                  category: 'ERP',           kind: 'API Key',   description: 'Enterprise resource planning' },
  { id: 'netsuite',      label: 'NetSuite',             category: 'ERP',           kind: 'API Key',   description: 'Oracle cloud ERP for businesses' },
  { id: 'zoho_books',    label: 'Zoho Books',           category: 'ERP',           kind: 'API Key',   description: 'Online accounting for growing businesses' },
  { id: 'zoho_desk',     label: 'Zoho Desk',            category: 'ERP',           kind: 'API Key',   description: 'Zoho helpdesk and support' },
  { id: 'zoho_mail',     label: 'Zoho Mail',            category: 'ERP',           kind: 'API Key',   description: 'Zoho email hosting and API' },
  // ── Automation & Integration (12) ──
  { id: 'webhook',       label: 'Webhook',              category: 'Automation',    kind: 'URL',       description: 'Send/receive webhook calls' },
  { id: 'zapier',        label: 'Zapier',               category: 'Automation',    kind: 'URL',       description: 'Trigger Zapier zaps via webhook' },
  { id: 'make',          label: 'Make (Integromat)',     category: 'Automation',    kind: 'URL',       description: 'Trigger Make scenarios via webhook' },
  { id: 'n8n',           label: 'n8n',                  category: 'Automation',    kind: 'API Key',   description: 'Self-hosted workflow automation' },
  { id: 'pipedream',     label: 'Pipedream',            category: 'Automation',    kind: 'API Key',   description: 'Serverless integration and workflow platform' },
  { id: 'ifttt',         label: 'IFTTT',                category: 'Automation',    kind: 'API Key',   description: 'If This Then That – simple automations' },
  { id: 'power_automate',label: 'Power Automate',       category: 'Automation',    kind: 'API Key',   description: 'Microsoft workflow automation' },
  { id: 'activepieces',  label: 'Activepieces',         category: 'Automation',    kind: 'API Key',   description: 'Open-source automation platform' },
  { id: 'windmill',      label: 'Windmill',             category: 'Automation',    kind: 'API Key',   description: 'Developer platform for scripts and workflows' },
  { id: 'temporal',      label: 'Temporal',             category: 'Automation',    kind: 'API Key',   description: 'Durable execution platform' },
  { id: 'inngest',       label: 'Inngest',              category: 'Automation',    kind: 'API Key',   description: 'Event-driven serverless functions' },
  { id: 'trigger_dev',   label: 'Trigger.dev',          category: 'Automation',    kind: 'API Key',   description: 'Background jobs for serverless' },
  // ── Design & Media (6) ──
  { id: 'figma',         label: 'Figma',                category: 'Design',        kind: 'API Key',   description: 'Design collaboration and API' },
  { id: 'canva',         label: 'Canva',                category: 'Design',        kind: 'API Key',   description: 'Graphic design platform API' },
  { id: 'cloudinary',    label: 'Cloudinary',           category: 'Design',        kind: 'API Key',   description: 'Image and video optimization' },
  { id: 'imgix',         label: 'Imgix',                category: 'Design',        kind: 'API Key',   description: 'Real-time image processing' },
  { id: 'mux',           label: 'Mux',                  category: 'Design',        kind: 'API Key',   description: 'Video streaming and analytics' },
  { id: 'loom',          label: 'Loom',                 category: 'Design',        kind: 'API Key',   description: 'Video messaging and recording API' },
  // ── Security & Auth (6) ──
  { id: 'auth0',         label: 'Auth0',                category: 'Security',      kind: 'API Key',   description: 'Identity and access management' },
  { id: 'clerk',         label: 'Clerk',                category: 'Security',      kind: 'API Key',   description: 'Authentication and user management' },
  { id: 'okta',          label: 'Okta',                 category: 'Security',      kind: 'API Key',   description: 'Enterprise identity management' },
  { id: 'snyk',          label: 'Snyk',                 category: 'Security',      kind: 'API Key',   description: 'Developer security scanning' },
  { id: 'onepassword',   label: '1Password',            category: 'Security',      kind: 'API Key',   description: 'Password management and secrets' },
  { id: 'vault',         label: 'HashiCorp Vault',      category: 'Security',      kind: 'API Key',   description: 'Secrets management and encryption' },
  // ── Browser Session ──
  { id: 'browser_session', label: 'Browser Session (Cookies)', category: 'Session', kind: 'Auto', description: 'Use current browser cookies for authenticated automation' },
];

/* ── Ports ── */
const HTTP_PORT = 18789;
const WS_PORT   = 18792;

/* ══════════════ HTTP Server ══════════════ */
const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);

  /* ── Health ── */
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      app: 'AMI Browser Gateway',
      version: '2.0.0',
      uptime: process.uptime(),
      clients: connectedClients.size,
    }));
    return;
  }

  /* ── Status ── */
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      gateway: true,
      relay: wsServer !== null,
      mcp: mcpProcess !== null && mcpProcess.exitCode === null,
      clients: connectedClients.size,
    }));
    return;
  }

  /* ── Chat ── */
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const data = JSON.parse(body);
      const message = data.message || '';
      console.log(`[chat] ${data.source || 'hub'}: ${message.slice(0, 100)}`);

      chatHistory.push({ role: 'user', content: message, ts: Date.now() });

      // Auto-detect LLM config from .env when no config provided (built-in OpenClaw)
      const effectiveConfig = data.config && data.config.provider && data.config.provider !== 'none'
        ? data.config
        : getAutoConfig();

      // Process the message — either forward to LLM or handle locally
      const reply = await processChat(message, effectiveConfig, data.history, data.pageContext);

      chatHistory.push({ role: 'agent', content: reply.reply, ts: Date.now() });

      // Broadcast to WS clients
      broadcast({ type: 'agent-reply', text: reply.reply, actions: reply.actions });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  /* ── Cron execution endpoint ── */
  if (url.pathname === '/api/cron' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const data = JSON.parse(body);
      console.log(`[cron] Executing job: ${data.name || data.jobId}`);
      // Use config from request if provided, otherwise try stored config
      const cronConfig = data.config || null;
      const reply = await processChat(data.task || data.message, cronConfig, []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  /* ── Model catalog ── */
  if (url.pathname === '/api/models' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { provider, apiKey } = JSON.parse(body);
      const models = await fetchModelCatalog(provider, apiKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, models: [] }));
    }
    return;
  }

  /* ── Speech-to-text (Mistral Voxtral) ── */
  if (url.pathname === '/api/stt' && req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const audioBuffer = Buffer.concat(chunks);
      const boundary = '----AMIBoundary' + Date.now();
      const key = envKey('MISTRAL_API_KEY');
      if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'MISTRAL_API_KEY not set in .env' })); return; }

      const formParts = [];
      formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nvoxtral-mini-latest\r\n`);
      formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`);
      const formEnd = `\r\n--${boundary}--\r\n`;
      const bodyBuf = Buffer.concat([Buffer.from(formParts.join('')), audioBuffer, Buffer.from(formEnd)]);

      const sttResp = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: bodyBuf,
      });
      const sttData = await sttResp.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: sttData.text || '' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  /* ── Text-to-speech (Mistral) ── */
  if (url.pathname === '/api/tts' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { text, voice } = JSON.parse(body);
      const key = envKey('MISTRAL_API_KEY');
      if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'MISTRAL_API_KEY not set in .env' })); return; }

      const ttsResp = await fetch('https://api.mistral.ai/v1/audio/speech', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'mistral-tts-latest', input: text, voice: voice || 'alloy' }),
      });
      if (!ttsResp.ok) throw new Error(`TTS API ${ttsResp.status}`);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      const arrayBuf = await ttsResp.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  /* ── Providers catalog ── */
  if (url.pathname === '/api/providers' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ providers: PROVIDER_CATALOG }));
    return;
  }

  /* ── Skills catalog ── */
  if (url.pathname === '/api/skills' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ skills: getSkillsPayload(), total: SKILLS.length }));
    return;
  }

  /* ── Connections: GET list ── */
  if (url.pathname === '/api/connections' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connections: savedConnections.map(c => ({ ...c, secret: '••••••' })) }));
    return;
  }

  /* ── Connections: POST save ── */
  if (url.pathname === '/api/connections' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { provider, name, secret, metadata, model } = JSON.parse(body);
      if (!provider || !name || !secret) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'provider, name and secret are required' }));
        return;
      }
      const conn = {
        id: `conn_${Date.now()}`,
        provider,
        name,
        secret: encryptSecret(secret),
        metadata: metadata || '',
        model: model || '',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      savedConnections.push(conn);
      persistConnections();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: conn.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  /* ── Connections: Test a credential before saving ── */
  if (url.pathname === '/api/connections/test' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { provider, secret, metadata, connectionId } = JSON.parse(body);
      if (!provider || !secret) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'provider and secret are required' }));
        return;
      }
      const result = await testConnection(provider, secret, metadata);
      /* If connectionId supplied, update stored status */
      if (connectionId) {
        const conn = savedConnections.find(c => c.id === connectionId);
        if (conn) {
          conn.status = result.ok ? 'active' : 'error';
          conn.updatedAt = new Date().toISOString();
          persistConnections();
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  /* ── Connections: DELETE ── */
  if (url.pathname.startsWith('/api/connections/') && req.method === 'DELETE') {
    const id = url.pathname.split('/').pop();
    const idx = savedConnections.findIndex(c => c.id === id);
    if (idx !== -1) {
      savedConnections.splice(idx, 1);
      persistConnections();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
    return;
  }

  /* ── Connections: GET decrypted secret (internal only – localhost) ── */
  if (url.pathname.match(/^\/api\/connections\/[^/]+\/secret$/) && req.method === 'GET') {
    const parts = url.pathname.split('/');
    const id = parts[3];
    const conn = savedConnections.find(c => c.id === id);
    if (!conn) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    try {
      const decrypted = decryptSecret(conn.secret);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: conn.id, provider: conn.provider, secret: decrypted }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Decryption failed' }));
    }
    return;
  }

  /* ── Connections: GET by provider (find credential for a specific service) ── */
  if (url.pathname === '/api/connections/by-provider' && req.method === 'GET') {
    const provider = url.searchParams.get('provider');
    if (!provider) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'provider query param required' }));
      return;
    }
    const matches = savedConnections.filter(c => c.provider === provider);
    if (!matches.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No connection for provider: ${provider}` }));
      return;
    }
    // Return the first match with decrypted secret
    try {
      const conn = matches[0];
      const decrypted = decryptSecret(conn.secret);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: conn.id, provider: conn.provider, name: conn.name, secret: decrypted }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Decryption failed' }));
    }
    return;
  }

  /* ── Proxy API call (agent uses saved connections to call third-party APIs) ── */
  if (url.pathname === '/api/proxy-call' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { connectionId, provider, url: targetUrl, method: httpMethod, headers: extraHeaders, body: reqBody } = JSON.parse(body);
      if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'url is required' }));
        return;
      }
      // Only allow HTTPS or localhost
      if (!targetUrl.startsWith('https://') && !targetUrl.startsWith('http://127.0.0.1') && !targetUrl.startsWith('http://localhost')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only HTTPS or localhost URLs are allowed' }));
        return;
      }
      // Resolve credential
      let credential = null;
      if (connectionId) {
        const conn = savedConnections.find(c => c.id === connectionId);
        if (conn) credential = decryptSecret(conn.secret);
      } else if (provider) {
        const conn = savedConnections.find(c => c.provider === provider);
        if (conn) credential = decryptSecret(conn.secret);
      }
      const fetchHeaders = { ...(extraHeaders || {}) };
      if (credential && !fetchHeaders['Authorization']) {
        fetchHeaders['Authorization'] = `Bearer ${credential}`;
      }
      if (!fetchHeaders['Content-Type']) fetchHeaders['Content-Type'] = 'application/json';
      const fetchOpts = { method: httpMethod || 'GET', headers: fetchHeaders };
      if (reqBody && fetchOpts.method !== 'GET') {
        fetchOpts.body = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
      }
      const proxyResp = await fetch(targetUrl, fetchOpts);
      const proxyText = await proxyResp.text();
      let proxyData;
      try { proxyData = JSON.parse(proxyText); } catch { proxyData = proxyText; }
      res.writeHead(proxyResp.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: proxyResp.status, ok: proxyResp.ok, data: proxyData }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[gateway] Port ${HTTP_PORT} already in use. Kill the existing process or choose a different port.`);
    process.exit(1);
  }
  console.error('[gateway] HTTP error:', err);
});

/* ══════════════ WebSocket Relay ══════════════ */
function startRelay() {
  try {
    wsServer = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
    wsServer.on('listening', () => console.log(`[gateway] WebSocket relay on ws://127.0.0.1:${WS_PORT}`));
    wsServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[gateway] Port ${WS_PORT} in use — relay skipped`);
      }
    });

    wsServer.on('connection', (ws) => {
      connectedClients.add(ws);
      console.log(`[gateway] Client connected (${connectedClients.size})`);

      ws.on('message', (data) => {
        for (const c of connectedClients) {
          if (c !== ws && c.readyState === 1) c.send(data);
        }
      });
      ws.on('close', () => { connectedClients.delete(ws); });
      ws.on('error', () => { connectedClients.delete(ws); });
    });
  } catch (err) {
    console.warn('[gateway] Could not start relay:', err.message);
  }
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of connectedClients) {
    if (c.readyState === 1) c.send(data);
  }
}

/* ══════════════ MCP Server ══════════════ */
function startMCP() {
  const mcpPath = path.join(__dirname, '..', 'devtools-mcp-server', 'server.js');
  try {
    mcpProcess = spawn('node', [mcpPath], { stdio: 'pipe', env: { ...process.env } });
    mcpProcess.stdout?.on('data', d => console.log(`[mcp] ${d.toString().trim()}`));
    mcpProcess.stderr?.on('data', d => console.warn(`[mcp:err] ${d.toString().trim()}`));
    mcpProcess.on('exit', code => { console.log(`[mcp] Exited (${code})`); mcpProcess = null; });
    console.log(`[gateway] MCP server PID ${mcpProcess.pid}`);
  } catch (err) {
    console.warn('[gateway] Could not start MCP:', err.message);
  }
}

/* ══════════════ Built-in OpenClaw – auto-detect LLM from .env ══════════════ */
function getAutoConfig() {
  // Priority order: Mistral (fast + cheap) > OpenAI > Anthropic > Gemini > Grok > DeepSeek > OpenRouter > HuggingFace > Ollama
  if (envKey('MISTRAL_API_KEY'))    return { provider: 'mistral',    apiKey: envKey('MISTRAL_API_KEY'),    model: 'mistral-small-latest' };
  if (envKey('OPENAI_API_KEY'))     return { provider: 'openai',     apiKey: envKey('OPENAI_API_KEY'),     model: 'gpt-4o-mini' };
  if (envKey('ANTHROPIC_API_KEY'))  return { provider: 'anthropic',  apiKey: envKey('ANTHROPIC_API_KEY'),  model: 'claude-sonnet-4-20250514' };
  if (envKey('GEMINI_API_KEY'))     return { provider: 'gemini',     apiKey: envKey('GEMINI_API_KEY'),     model: 'gemini-2.0-flash' };
  if (envKey('GROK_API_KEY'))       return { provider: 'grok',       apiKey: envKey('GROK_API_KEY'),       model: 'grok-3-mini' };
  if (envKey('XAI_API_KEY'))        return { provider: 'grok',       apiKey: envKey('XAI_API_KEY'),        model: 'grok-3-mini' };
  if (envKey('DEEPSEEK_API_KEY'))   return { provider: 'deepseek',   apiKey: envKey('DEEPSEEK_API_KEY'),   model: 'deepseek-chat' };
  if (envKey('OPENROUTER_API_KEY')) return { provider: 'openrouter', apiKey: envKey('OPENROUTER_API_KEY'), model: 'auto' };
  if (envKey('HUGGINGFACE_TOKEN'))  return { provider: 'huggingface',apiKey: envKey('HUGGINGFACE_TOKEN'),  model: 'mistralai/Mistral-7B-Instruct-v0.3' };
  // Check if Ollama is likely running locally
  return null;
}

/* ══════════════ Chat processing ══════════════ */

/* ── 130+ Built-in Skills Registry ── */
const SKILLS = [
  // ─── Navigation & Browsing (15) ───
  { id: 'navigate', cat: 'Navigation', pattern: /^(?:go to|open|navigate to?|visit|browse)\s+(?!.*\b(?:and|then)\b.*(?:play|search|watch|type|click|fill|find|do))(.+)/i, desc: 'Navigate to a URL or website', handler: (m) => { let url = m[1].trim(); if (!url.startsWith('http')) url = `https://${url}`; return { reply: `Navigating to ${url}`, actions: [{ type: 'navigate', url }] }; } },
  { id: 'search-web', cat: 'Navigation', pattern: /^(?:search|google|look up|find on web|web search)\s+(.+)/i, desc: 'Search the web for a query', handler: (m) => ({ reply: `Searching: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-youtube', cat: 'Navigation', pattern: /^(?:youtube|search youtube|find video|watch)\s+(.+)/i, desc: 'Search YouTube for videos', handler: (m) => ({ reply: `Searching YouTube: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-spotify', cat: 'Navigation', pattern: /^(?:spotify|search spotify|find song|find music)\s+(.+)/i, desc: 'Search Spotify for music', handler: (m) => ({ reply: `Searching Spotify: ${m[1]}`, actions: [{ type: 'navigate', url: `https://open.spotify.com/search/${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-soundcloud', cat: 'Navigation', pattern: /^(?:soundcloud|search soundcloud)\s+(.+)/i, desc: 'Search SoundCloud', handler: (m) => ({ reply: `Searching SoundCloud: ${m[1]}`, actions: [{ type: 'navigate', url: `https://soundcloud.com/search?q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-amazon', cat: 'Navigation', pattern: /^(?:amazon|search amazon|shop|buy)\s+(.+)/i, desc: 'Search Amazon for products', handler: (m) => ({ reply: `Searching Amazon: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.amazon.com/s?k=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-stackoverflow', cat: 'Navigation', pattern: /^(?:stackoverflow|stack overflow|search stackoverflow)\s+(.+)/i, desc: 'Search Stack Overflow', handler: (m) => ({ reply: `Searching Stack Overflow: ${m[1]}`, actions: [{ type: 'navigate', url: `https://stackoverflow.com/search?q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-npm', cat: 'Navigation', pattern: /^(?:npm search|search npm|find package)\s+(.+)/i, desc: 'Search npm packages', handler: (m) => ({ reply: `Searching npm: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.npmjs.com/search?q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-twitch', cat: 'Navigation', pattern: /^(?:twitch|search twitch|find stream)\s+(.+)/i, desc: 'Search Twitch', handler: (m) => ({ reply: `Searching Twitch: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.twitch.tv/search?term=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-netflix', cat: 'Navigation', pattern: /^(?:netflix|search netflix)\s+(.+)/i, desc: 'Search Netflix', handler: (m) => ({ reply: `Searching Netflix: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.netflix.com/search?q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-github', cat: 'Navigation', pattern: /^(?:github search|search github|find repo|find repository)\s+(.+)/i, desc: 'Search GitHub for repositories', handler: (m) => ({ reply: `Searching GitHub: ${m[1]}`, actions: [{ type: 'navigate', url: `https://github.com/search?q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-reddit', cat: 'Navigation', pattern: /^(?:reddit search|search reddit)\s+(.+)/i, desc: 'Search Reddit', handler: (m) => ({ reply: `Searching Reddit: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.reddit.com/search/?q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-twitter', cat: 'Navigation', pattern: /^(?:twitter search|search twitter|search x|x search)\s+(.+)/i, desc: 'Search Twitter/X', handler: (m) => ({ reply: `Searching X: ${m[1]}`, actions: [{ type: 'navigate', url: `https://x.com/search?q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-maps', cat: 'Navigation', pattern: /^(?:map|maps|directions|find location|locate)\s+(.+)/i, desc: 'Search Google Maps', handler: (m) => ({ reply: `Opening Maps: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/maps/search/${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-images', cat: 'Navigation', pattern: /^(?:image search|search images|find images?)\s+(.+)/i, desc: 'Search Google Images', handler: (m) => ({ reply: `Searching images: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(m[1])}` }] }) },
  { id: 'search-news', cat: 'Navigation', pattern: /^(?:news|search news|latest news|headlines)\s*(.+)?/i, desc: 'Search Google News', handler: (m) => ({ reply: `Searching news: ${m[1] || 'latest'}`, actions: [{ type: 'navigate', url: `https://news.google.com/search?q=${encodeURIComponent(m[1] || 'latest')}` }] }) },
  { id: 'search-wikipedia', cat: 'Navigation', pattern: /^(?:wiki|wikipedia)\s+(.+)/i, desc: 'Search Wikipedia', handler: (m) => ({ reply: `Searching Wikipedia: ${m[1]}`, actions: [{ type: 'navigate', url: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(m[1])}` }] }) },
  { id: 'new-tab', cat: 'Navigation', pattern: /^(?:new tab|open tab)/i, desc: 'Open a new tab', handler: () => ({ reply: 'Opening new tab', actions: [{ type: 'new-tab' }] }) },
  { id: 'close-tab', cat: 'Navigation', pattern: /^(?:close tab|close this tab)/i, desc: 'Close current tab', handler: () => ({ reply: 'Closing tab', actions: [{ type: 'close-tab' }] }) },
  { id: 'go-back', cat: 'Navigation', pattern: /^(?:go back|back|previous page)/i, desc: 'Go to previous page', handler: () => ({ reply: 'Going back', actions: [{ type: 'go-back' }] }) },
  { id: 'go-forward', cat: 'Navigation', pattern: /^(?:go forward|forward|next page)/i, desc: 'Go to next page', handler: () => ({ reply: 'Going forward', actions: [{ type: 'go-forward' }] }) },
  { id: 'reload', cat: 'Navigation', pattern: /^(?:reload|refresh|refresh page)/i, desc: 'Reload current page', handler: () => ({ reply: 'Reloading page', actions: [{ type: 'reload' }] }) },

  // ─── Page Interaction (12) ───
  { id: 'click', cat: 'Interaction', pattern: /^click\s+(?:on\s+)?["']?(.+?)["']?\s*$/i, desc: 'Click an element on the page', handler: (m) => ({ reply: `Clicking: ${m[1]}`, actions: [{ type: 'click', selector: m[1] }] }) },
  { id: 'type', cat: 'Interaction', pattern: /^type\s+["'](.+?)["']\s+(?:in|into)\s+["']?(.+?)["']?\s*$/i, desc: 'Type text into an input field', handler: (m) => ({ reply: `Typing "${m[1]}" into ${m[2]}`, actions: [{ type: 'type', text: m[1], selector: m[2] }] }) },
  { id: 'scroll-down', cat: 'Interaction', pattern: /^scroll\s+down/i, desc: 'Scroll the page down', handler: () => ({ reply: 'Scrolling down', actions: [{ type: 'scroll', y: 500 }] }) },
  { id: 'scroll-up', cat: 'Interaction', pattern: /^scroll\s+up/i, desc: 'Scrolling up', handler: () => ({ reply: 'Scrolling up', actions: [{ type: 'scroll', y: -500 }] }) },
  { id: 'scroll-top', cat: 'Interaction', pattern: /^scroll\s+(?:to\s+)?top/i, desc: 'Scroll to top of page', handler: () => ({ reply: 'Scrolling to top', actions: [{ type: 'scroll-to', y: 0 }] }) },
  { id: 'scroll-bottom', cat: 'Interaction', pattern: /^scroll\s+(?:to\s+)?bottom/i, desc: 'Scroll to bottom of page', handler: () => ({ reply: 'Scrolling to bottom', actions: [{ type: 'scroll-to', y: 99999 }] }) },
  { id: 'select-option', cat: 'Interaction', pattern: /^select\s+["'](.+?)["']\s+(?:in|from)\s+["']?(.+?)["']?\s*$/i, desc: 'Select an option from a dropdown', handler: (m) => ({ reply: `Selecting "${m[1]}" from ${m[2]}`, actions: [{ type: 'select', value: m[1], selector: m[2] }] }) },
  { id: 'check-box', cat: 'Interaction', pattern: /^(?:check|tick|enable)\s+["']?(.+?)["']?\s*$/i, desc: 'Check a checkbox', handler: (m) => ({ reply: `Checking: ${m[1]}`, actions: [{ type: 'check', selector: m[1] }] }) },
  { id: 'uncheck-box', cat: 'Interaction', pattern: /^(?:uncheck|untick|disable)\s+["']?(.+?)["']?\s*$/i, desc: 'Uncheck a checkbox', handler: (m) => ({ reply: `Unchecking: ${m[1]}`, actions: [{ type: 'uncheck', selector: m[1] }] }) },
  { id: 'hover', cat: 'Interaction', pattern: /^hover\s+(?:over\s+)?["']?(.+?)["']?\s*$/i, desc: 'Hover over an element', handler: (m) => ({ reply: `Hovering over: ${m[1]}`, actions: [{ type: 'hover', selector: m[1] }] }) },
  { id: 'focus', cat: 'Interaction', pattern: /^focus\s+(?:on\s+)?["']?(.+?)["']?\s*$/i, desc: 'Focus an input element', handler: (m) => ({ reply: `Focusing: ${m[1]}`, actions: [{ type: 'focus', selector: m[1] }] }) },
  { id: 'submit-form', cat: 'Interaction', pattern: /^(?:submit form|submit|press enter|hit enter)/i, desc: 'Submit the current form', handler: () => ({ reply: 'Submitting form', actions: [{ type: 'submit' }] }) },

  // ─── Data Extraction (15) ───
  { id: 'extract-text', cat: 'Extraction', pattern: /^(?:extract text|get text|read page|read text|get page text|page content)/i, desc: 'Extract all text from the current page', handler: () => ({ reply: 'Extracting page text…', actions: [{ type: 'extract-text' }] }) },
  { id: 'extract-links', cat: 'Extraction', pattern: /^(?:extract links|get links|find links|list links|all links)/i, desc: 'Extract all links from the page', handler: () => ({ reply: 'Extracting all links…', actions: [{ type: 'extract-links' }] }) },
  { id: 'extract-images', cat: 'Extraction', pattern: /^(?:extract images|get images|find images|list images|all images)/i, desc: 'Extract all image URLs from the page', handler: () => ({ reply: 'Extracting images…', actions: [{ type: 'extract-images' }] }) },
  { id: 'extract-emails', cat: 'Extraction', pattern: /^(?:extract emails?|find emails?|get emails?|scrape emails?)/i, desc: 'Find email addresses on the page', handler: () => ({ reply: 'Extracting email addresses…', actions: [{ type: 'extract-emails' }] }) },
  { id: 'extract-phones', cat: 'Extraction', pattern: /^(?:extract phones?|find phones?|get phone numbers?)/i, desc: 'Find phone numbers on the page', handler: () => ({ reply: 'Extracting phone numbers…', actions: [{ type: 'extract-phones' }] }) },
  { id: 'extract-table', cat: 'Extraction', pattern: /^(?:extract table|scrape table|get table|read table)/i, desc: 'Extract table data from the page', handler: () => ({ reply: 'Extracting table data…', actions: [{ type: 'extract-table' }] }) },
  { id: 'extract-headings', cat: 'Extraction', pattern: /^(?:extract headings?|get headings?|list headings?|page outline)/i, desc: 'Extract headings (H1-H6) from the page', handler: () => ({ reply: 'Extracting headings…', actions: [{ type: 'extract-headings' }] }) },
  { id: 'extract-meta', cat: 'Extraction', pattern: /^(?:extract meta|get meta|page meta|metadata)/i, desc: 'Extract page metadata (title, description, etc.)', handler: () => ({ reply: 'Extracting page metadata…', actions: [{ type: 'extract-meta' }] }) },
  { id: 'extract-prices', cat: 'Extraction', pattern: /^(?:extract prices?|find prices?|get prices?|scrape prices?)/i, desc: 'Find prices on the page', handler: () => ({ reply: 'Extracting prices…', actions: [{ type: 'extract-prices' }] }) },
  { id: 'extract-structured', cat: 'Extraction', pattern: /^(?:extract data|structured data|extract json|scrape data)\s*(.+)?/i, desc: 'Extract structured data from the page', handler: (m) => ({ reply: `Extracting structured data${m[1] ? ': ' + m[1] : ''}…`, actions: [{ type: 'extract-structured', query: m[1] || '' }] }) },
  { id: 'extract-selected', cat: 'Extraction', pattern: /^(?:get selection|selected text|read selection|what.?s selected)/i, desc: 'Get the currently selected text', handler: () => ({ reply: 'Reading selected text…', actions: [{ type: 'extract-selected' }] }) },
  { id: 'summarize-page', cat: 'Extraction', pattern: /^(?:summarize|summarise|summary|tldr|tl;dr)\s*(?:this page|page|this)?\s*$/i, desc: 'Summarize the current page content', handler: () => ({ reply: 'Summarizing page content…', actions: [{ type: 'summarize-page' }] }) },
  { id: 'extract-forms', cat: 'Extraction', pattern: /^(?:extract forms?|find forms?|list forms?|get forms?)/i, desc: 'List all forms on the page', handler: () => ({ reply: 'Extracting form data…', actions: [{ type: 'extract-forms' }] }) },
  { id: 'count-elements', cat: 'Extraction', pattern: /^(?:count)\s+["']?(.+?)["']?\s*$/i, desc: 'Count elements matching a selector', handler: (m) => ({ reply: `Counting "${m[1]}" elements…`, actions: [{ type: 'count-elements', selector: m[1] }] }) },
  { id: 'read-attribute', cat: 'Extraction', pattern: /^(?:get attribute|read attribute)\s+["'](.+?)["']\s+(?:of|from)\s+["']?(.+?)["']?\s*$/i, desc: 'Read an attribute from an element', handler: (m) => ({ reply: `Reading "${m[1]}" from ${m[2]}…`, actions: [{ type: 'read-attribute', attr: m[1], selector: m[2] }] }) },

  // ─── Screenshot & Visual (6) ───
  { id: 'screenshot', cat: 'Visual', pattern: /^(?:screenshot|capture|snap|take screenshot)/i, desc: 'Take a screenshot of the visible page', handler: () => ({ reply: 'Taking screenshot…', actions: [{ type: 'screenshot' }] }) },
  { id: 'screenshot-element', cat: 'Visual', pattern: /^screenshot\s+(?:element|of)\s+["']?(.+?)["']?\s*$/i, desc: 'Screenshot a specific element', handler: (m) => ({ reply: `Screenshotting element: ${m[1]}`, actions: [{ type: 'screenshot-element', selector: m[1] }] }) },
  { id: 'highlight', cat: 'Visual', pattern: /^highlight\s+["']?(.+?)["']?\s*$/i, desc: 'Highlight an element on the page', handler: (m) => ({ reply: `Highlighting: ${m[1]}`, actions: [{ type: 'highlight', selector: m[1] }] }) },
  { id: 'inspect-element', cat: 'Visual', pattern: /^inspect\s+["']?(.+?)["']?\s*$/i, desc: 'Inspect a DOM element', handler: (m) => ({ reply: `Inspecting: ${m[1]}`, actions: [{ type: 'inspect', selector: m[1] }] }) },
  { id: 'zoom-in', cat: 'Visual', pattern: /^zoom\s+in/i, desc: 'Zoom in on the page', handler: () => ({ reply: 'Zooming in', actions: [{ type: 'zoom', level: 1.25 }] }) },
  { id: 'zoom-out', cat: 'Visual', pattern: /^zoom\s+out/i, desc: 'Zoom out on the page', handler: () => ({ reply: 'Zooming out', actions: [{ type: 'zoom', level: 0.8 }] }) },

  // ─── Form Prefilling (6) ───
  { id: 'fill-form', cat: 'Forms', pattern: /^(?:fill form|fill in|auto-?fill|prefill)\s*(.+)?/i, desc: 'Auto-fill a form using context or scraped data', handler: (m) => ({ reply: `Auto-filling form${m[1] ? ' with: ' + m[1] : ''}…`, actions: [{ type: 'fill-form', data: m[1] || '' }] }) },
  { id: 'fill-field', cat: 'Forms', pattern: /^(?:fill|set)\s+["']?(.+?)["']?\s+(?:to|with|as)\s+["'](.+?)["']/i, desc: 'Fill a specific field with a value', handler: (m) => ({ reply: `Setting ${m[1]} to "${m[2]}"`, actions: [{ type: 'type', selector: m[1], text: m[2] }] }) },
  { id: 'clear-field', cat: 'Forms', pattern: /^clear\s+["']?(.+?)["']?\s*$/i, desc: 'Clear an input field', handler: (m) => ({ reply: `Clearing: ${m[1]}`, actions: [{ type: 'clear', selector: m[1] }] }) },
  { id: 'clear-form', cat: 'Forms', pattern: /^(?:clear form|reset form)/i, desc: 'Clear/reset the current form', handler: () => ({ reply: 'Clearing form', actions: [{ type: 'clear-form' }] }) },
  { id: 'upload-file', cat: 'Forms', pattern: /^(?:upload|attach file)\s+["']?(.+?)["']?\s*$/i, desc: 'Upload a file to an input', handler: (m) => ({ reply: `Uploading: ${m[1]}`, actions: [{ type: 'upload-file', file: m[1] }] }) },
  { id: 'prefill-from-data', cat: 'Forms', pattern: /^(?:prefill from|use data from|import data)\s+(.+)/i, desc: 'Prefill form from previously extracted data', handler: (m) => ({ reply: `Prefilling form from ${m[1]}…`, actions: [{ type: 'prefill-from-data', source: m[1] }] }) },

  // ─── Content Creation (12) ───
  { id: 'write-email', cat: 'Content', pattern: /^(?:write|draft|compose)\s+(?:an?\s+)?email\s+(?:to\s+)?(.+)/i, desc: 'Draft an email', handler: (m) => ({ reply: `Drafting email: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'write-email', prompt: m[1] }] }) },
  { id: 'write-tweet', cat: 'Content', pattern: /^(?:write|draft|compose)\s+(?:a\s+)?(?:tweet|post|thread)\s+(?:about\s+)?(.+)/i, desc: 'Draft a tweet or social post', handler: (m) => ({ reply: `Drafting post: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'write-post', prompt: m[1] }] }) },
  { id: 'write-summary', cat: 'Content', pattern: /^(?:write|create)\s+(?:a\s+)?summary\s+(?:of\s+)?(.+)/i, desc: 'Write a summary of given content', handler: (m) => ({ reply: `Summarizing: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'summarize', prompt: m[1] }] }) },
  { id: 'translate', cat: 'Content', pattern: /^translate\s+(.+?)\s+(?:to|into)\s+(\w+)/i, desc: 'Translate text to another language', handler: (m) => ({ reply: `Translating to ${m[2]}…`, actions: [{ type: 'llm-task', task: 'translate', prompt: m[1], lang: m[2] }] }) },
  { id: 'rewrite', cat: 'Content', pattern: /^(?:rewrite|rephrase|paraphrase)\s+(.+)/i, desc: 'Rewrite or paraphrase text', handler: (m) => ({ reply: 'Rewriting text…', actions: [{ type: 'llm-task', task: 'rewrite', prompt: m[1] }] }) },
  { id: 'expand-text', cat: 'Content', pattern: /^expand\s+(.+)/i, desc: 'Expand/elaborate on text', handler: (m) => ({ reply: 'Expanding text…', actions: [{ type: 'llm-task', task: 'expand', prompt: m[1] }] }) },
  { id: 'shorten-text', cat: 'Content', pattern: /^(?:shorten|condense|make shorter)\s+(.+)/i, desc: 'Shorten text', handler: (m) => ({ reply: 'Shortening text…', actions: [{ type: 'llm-task', task: 'shorten', prompt: m[1] }] }) },
  { id: 'proofread', cat: 'Content', pattern: /^(?:proofread|spellcheck|grammar check|fix grammar)\s+(.+)/i, desc: 'Proofread and fix grammar', handler: (m) => ({ reply: 'Proofreading…', actions: [{ type: 'llm-task', task: 'proofread', prompt: m[1] }] }) },
  { id: 'generate-ideas', cat: 'Content', pattern: /^(?:brainstorm|ideas?|generate ideas?)\s+(?:for\s+)?(.+)/i, desc: 'Generate creative ideas', handler: (m) => ({ reply: `Brainstorming ideas: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'brainstorm', prompt: m[1] }] }) },
  { id: 'write-code', cat: 'Content', pattern: /^(?:write code|code|generate code|programming)\s+(?:for\s+|to\s+)?(.+)/i, desc: 'Generate code for a task', handler: (m) => ({ reply: `Writing code: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'write-code', prompt: m[1] }] }) },
  { id: 'explain-code', cat: 'Content', pattern: /^(?:explain code|explain this code|what does this code do)\s*(.+)?/i, desc: 'Explain a code snippet', handler: (m) => ({ reply: 'Explaining code…', actions: [{ type: 'llm-task', task: 'explain-code', prompt: m[1] || '' }] }) },
  { id: 'write-regex', cat: 'Content', pattern: /^(?:regex|write regex|generate regex|regular expression)\s+(?:for\s+)?(.+)/i, desc: 'Generate a regular expression', handler: (m) => ({ reply: `Generating regex for: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'write-regex', prompt: m[1] }] }) },

  // ─── Research & Analysis (14) ───
  { id: 'compare', cat: 'Research', pattern: /^compare\s+(.+)/i, desc: 'Compare products, services, or topics', handler: (m) => ({ reply: `Comparing: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'compare', prompt: m[1] }] }) },
  { id: 'find-reviews', cat: 'Research', pattern: /^(?:find reviews?|reviews? for|check reviews?)\s+(.+)/i, desc: 'Find reviews for a product or service', handler: (m) => ({ reply: `Finding reviews: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=${encodeURIComponent(m[1] + ' reviews')}` }] }) },
  { id: 'analyze-sentiment', cat: 'Research', pattern: /^(?:sentiment|analyze sentiment|mood)\s+(.+)/i, desc: 'Analyze sentiment of text', handler: (m) => ({ reply: 'Analyzing sentiment…', actions: [{ type: 'llm-task', task: 'sentiment', prompt: m[1] }] }) },
  { id: 'fact-check', cat: 'Research', pattern: /^(?:fact check|verify|is it true)\s+(.+)/i, desc: 'Fact-check a claim', handler: (m) => ({ reply: `Fact-checking: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'fact-check', prompt: m[1] }] }) },
  { id: 'find-contacts', cat: 'Research', pattern: /^(?:find contacts?|get contact|contact info)\s+(?:for\s+)?(.+)/i, desc: 'Find contact information', handler: (m) => ({ reply: `Finding contacts for: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=${encodeURIComponent(m[1] + ' contact information')}` }] }) },
  { id: 'find-deals', cat: 'Research', pattern: /^(?:find deals?|coupons?|discounts?|promo codes?)\s+(?:for\s+)?(.+)/i, desc: 'Find deals and coupons', handler: (m) => ({ reply: `Finding deals: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=${encodeURIComponent(m[1] + ' coupon code deals')}` }] }) },
  { id: 'find-alternatives', cat: 'Research', pattern: /^(?:alternatives?\s+to|find alternatives?)\s+(.+)/i, desc: 'Find alternatives to a product or service', handler: (m) => ({ reply: `Finding alternatives to ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=${encodeURIComponent('alternatives to ' + m[1])}` }] }) },
  { id: 'research-topic', cat: 'Research', pattern: /^(?:research|deep dive|learn about|study)\s+(.+)/i, desc: 'Deep research on a topic', handler: (m) => ({ reply: `Researching: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'research', prompt: m[1] }] }) },
  { id: 'competitor-analysis', cat: 'Research', pattern: /^(?:competitor analysis|competitive analysis|analyze competitors?)\s+(?:for\s+)?(.+)/i, desc: 'Analyze competitors', handler: (m) => ({ reply: `Analyzing competitors: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'competitor-analysis', prompt: m[1] }] }) },
  { id: 'market-research', cat: 'Research', pattern: /^(?:market research|market analysis|market size)\s+(?:for\s+)?(.+)/i, desc: 'Market research for a topic', handler: (m) => ({ reply: `Market research: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'market-research', prompt: m[1] }] }) },
  { id: 'define', cat: 'Research', pattern: /^(?:define|meaning of|what is|what are|whats?)\s+(.+)/i, desc: 'Define a word or concept', handler: (m) => ({ reply: `Looking up: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'define', prompt: m[1] }] }) },
  { id: 'how-to', cat: 'Research', pattern: /^(?:how to|how do i|how can i)\s+(.+)/i, desc: 'Get step-by-step instructions', handler: (m) => ({ reply: `Finding how to: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'how-to', prompt: m[1] }] }) },
  { id: 'pros-cons', cat: 'Research', pattern: /^(?:pros and cons|pros cons|advantages disadvantages)\s+(?:of\s+)?(.+)/i, desc: 'List pros and cons', handler: (m) => ({ reply: `Analyzing pros and cons: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'pros-cons', prompt: m[1] }] }) },
  { id: 'explain', cat: 'Research', pattern: /^explain\s+(.+)/i, desc: 'Explain a concept simply', handler: (m) => ({ reply: `Explaining: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'explain', prompt: m[1] }] }) },

  // ─── Communication (10) ───
  { id: 'send-telegram', cat: 'Communication', pattern: /^(?:send|message)\s+(?:to\s+)?telegram\s+(.+)/i, desc: 'Send a Telegram message', handler: (m) => ({ reply: `Sending Telegram message…`, actions: [{ type: 'api-call', provider: 'telegram', method: 'POST', url: 'https://api.telegram.org/bot{key}/sendMessage', body: { text: m[1] } }] }) },
  { id: 'send-discord', cat: 'Communication', pattern: /^(?:send|message)\s+(?:to\s+)?discord\s+(.+)/i, desc: 'Send a Discord message', handler: (m) => ({ reply: `Sending Discord message…`, actions: [{ type: 'api-call', provider: 'discord', method: 'POST', body: { content: m[1] } }] }) },
  { id: 'send-slack', cat: 'Communication', pattern: /^(?:send|message)\s+(?:to\s+)?slack\s+(.+)/i, desc: 'Send a Slack message', handler: (m) => ({ reply: `Sending Slack message…`, actions: [{ type: 'api-call', provider: 'slack', method: 'POST', body: { text: m[1] } }] }) },
  { id: 'send-email-api', cat: 'Communication', pattern: /^send\s+email\s+(.+)/i, desc: 'Send an email via connected service', handler: (m) => ({ reply: `Sending email…`, actions: [{ type: 'api-call', provider: 'sendgrid', method: 'POST', body: { message: m[1] } }] }) },
  { id: 'compose-reply', cat: 'Communication', pattern: /^(?:compose|draft)\s+(?:a\s+)?reply\s+(?:to\s+)?(.+)/i, desc: 'Draft a reply message', handler: (m) => ({ reply: `Drafting reply…`, actions: [{ type: 'llm-task', task: 'compose-reply', prompt: m[1] }] }) },
  { id: 'summarize-thread', cat: 'Communication', pattern: /^summarize\s+(?:this\s+)?(?:thread|conversation|chat|discussion)/i, desc: 'Summarize a chat thread', handler: () => ({ reply: 'Summarizing conversation…', actions: [{ type: 'llm-task', task: 'summarize-thread' }] }) },
  { id: 'draft-response', cat: 'Communication', pattern: /^draft\s+(?:a\s+)?response\s+(.+)/i, desc: 'Draft a professional response', handler: (m) => ({ reply: 'Drafting response…', actions: [{ type: 'llm-task', task: 'draft-response', prompt: m[1] }] }) },
  { id: 'announce', cat: 'Communication', pattern: /^announce\s+(.+)/i, desc: 'Create an announcement', handler: (m) => ({ reply: 'Creating announcement…', actions: [{ type: 'llm-task', task: 'announce', prompt: m[1] }] }) },
  { id: 'send-webhook', cat: 'Communication', pattern: /^(?:trigger|send)\s+webhook\s+(.+)/i, desc: 'Trigger a webhook', handler: (m) => ({ reply: `Triggering webhook…`, actions: [{ type: 'api-call', provider: 'webhook', method: 'POST', body: { data: m[1] } }] }) },
  { id: 'notify', cat: 'Communication', pattern: /^notify\s+(.+)/i, desc: 'Send a notification', handler: (m) => ({ reply: `Notifying: ${m[1]}`, actions: [{ type: 'notify', message: m[1] }] }) },

  // ─── Finance & Crypto (14) ───
  { id: 'crypto-price', cat: 'Finance', pattern: /^(?:price (?:of )?|check price |what.?s the price of )(.+)/i, desc: 'Check cryptocurrency/stock price', handler: (m) => ({ reply: `Checking price: ${m[1]}…`, actions: [{ type: 'api-call', provider: 'coingecko', url: `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(m[1].toLowerCase())}&vs_currencies=usd`, method: 'GET' }] }) },
  { id: 'market-cap', cat: 'Finance', pattern: /^(?:market cap|mcap|marketcap)\s+(?:of\s+)?(.+)/i, desc: 'Check market capitalization', handler: (m) => ({ reply: `Checking market cap: ${m[1]}…`, actions: [{ type: 'api-call', provider: 'coingecko', url: `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(m[1].toLowerCase())}`, method: 'GET' }] }) },
  { id: 'trending-tokens', cat: 'Finance', pattern: /^(?:trending tokens?|trending crypto|what.?s trending|hot tokens?)/i, desc: 'Show trending cryptocurrency tokens', handler: () => ({ reply: 'Fetching trending tokens…', actions: [{ type: 'api-call', provider: 'coingecko', url: 'https://api.coingecko.com/api/v3/search/trending', method: 'GET' }] }) },
  { id: 'gas-price', cat: 'Finance', pattern: /^(?:gas price|eth gas|gas fees?)/i, desc: 'Check Ethereum gas prices', handler: () => ({ reply: 'Checking gas prices…', actions: [{ type: 'api-call', provider: 'etherscan', url: 'https://api.etherscan.io/api?module=gastracker&action=gasoracle', method: 'GET' }] }) },
  { id: 'check-wallet', cat: 'Finance', pattern: /^(?:check wallet|wallet balance|balance of)\s+(.+)/i, desc: 'Check crypto wallet balance', handler: (m) => ({ reply: `Checking wallet: ${m[1]}…`, actions: [{ type: 'api-call', provider: 'etherscan', url: `https://api.etherscan.io/api?module=account&action=balance&address=${encodeURIComponent(m[1])}&tag=latest`, method: 'GET' }] }) },
  { id: 'token-info', cat: 'Finance', pattern: /^(?:token info|about token|token details?)\s+(.+)/i, desc: 'Get token information', handler: (m) => ({ reply: `Getting token info: ${m[1]}…`, actions: [{ type: 'api-call', provider: 'coingecko', url: `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(m[1].toLowerCase())}`, method: 'GET' }] }) },
  { id: 'swap-quote', cat: 'Finance', pattern: /^(?:swap|trade|exchange)\s+(.+?)\s+(?:to|for)\s+(.+)/i, desc: 'Get a swap quote between tokens', handler: (m) => ({ reply: `Getting swap quote: ${m[1]} → ${m[2]}…`, actions: [{ type: 'api-call', provider: 'oneinch', method: 'GET' }] }) },
  { id: 'defi-portfolio', cat: 'Finance', pattern: /^(?:defi portfolio|my portfolio|portfolio)\s*(.+)?/i, desc: 'Check DeFi portfolio', handler: (m) => ({ reply: 'Checking DeFi portfolio…', actions: [{ type: 'api-call', provider: 'debank', method: 'GET' }] }) },
  { id: 'stock-price', cat: 'Finance', pattern: /^(?:stock price|stock)\s+(.+)/i, desc: 'Check stock price', handler: (m) => ({ reply: `Checking stock: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/finance/quote/${encodeURIComponent(m[1].toUpperCase())}` }] }) },
  { id: 'crypto-chart', cat: 'Finance', pattern: /^(?:chart|crypto chart|price chart)\s+(.+)/i, desc: 'View crypto price chart', handler: (m) => ({ reply: `Opening chart: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.coingecko.com/en/coins/${encodeURIComponent(m[1].toLowerCase())}` }] }) },
  { id: 'nft-search', cat: 'Finance', pattern: /^(?:nft|search nft|find nft)\s+(.+)/i, desc: 'Search for NFTs', handler: (m) => ({ reply: `Searching NFTs: ${m[1]}`, actions: [{ type: 'navigate', url: `https://opensea.io/search?query=${encodeURIComponent(m[1])}` }] }) },
  { id: 'tx-history', cat: 'Finance', pattern: /^(?:transactions?|tx history|transaction history)\s+(.+)/i, desc: 'View transaction history for an address', handler: (m) => ({ reply: `Viewing transactions: ${m[1]}`, actions: [{ type: 'navigate', url: `https://etherscan.io/address/${encodeURIComponent(m[1])}` }] }) },
  { id: 'defi-yields', cat: 'Finance', pattern: /^(?:defi yields?|best yields?|apy|yield farming)/i, desc: 'Find best DeFi yields', handler: () => ({ reply: 'Checking DeFi yields…', actions: [{ type: 'navigate', url: 'https://defillama.com/yields' }] }) },
  { id: 'convert-currency', cat: 'Finance', pattern: /^convert\s+(\d+\.?\d*)\s+(\w+)\s+to\s+(\w+)/i, desc: 'Convert between currencies', handler: (m) => ({ reply: `Converting ${m[1]} ${m[2]} to ${m[3]}…`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=${m[1]}+${m[2]}+to+${m[3]}` }] }) },

  // ─── Scheduling & Automation (10) ───
  { id: 'schedule', cat: 'Automation', pattern: /^(?:schedule|cron|every)\s+(.+)/i, desc: 'Schedule a recurring task', handler: (m) => ({ reply: `Scheduling: ${m[1]}. Opening scheduler…`, actions: [{ type: 'open-scheduler', task: m[1] }] }) },
  { id: 'remind', cat: 'Automation', pattern: /^(?:remind me|reminder|set reminder)\s+(.+)/i, desc: 'Set a reminder', handler: (m) => ({ reply: `Reminder set: ${m[1]}`, actions: [{ type: 'reminder', text: m[1] }] }) },
  { id: 'list-automations', cat: 'Automation', pattern: /^(?:list automations?|show automations?|my automations?|scheduled tasks?)/i, desc: 'List all scheduled automations', handler: () => ({ reply: 'Listing your automations…', actions: [{ type: 'list-automations' }] }) },
  { id: 'pause-all', cat: 'Automation', pattern: /^(?:pause all|pause automations?|stop automations?)/i, desc: 'Pause all automations', handler: () => ({ reply: 'Pausing all automations', actions: [{ type: 'pause-all' }] }) },
  { id: 'resume-all', cat: 'Automation', pattern: /^(?:resume all|resume automations?|start automations?|unpause)/i, desc: 'Resume all automations', handler: () => ({ reply: 'Resuming all automations', actions: [{ type: 'resume-all' }] }) },
  { id: 'create-routine', cat: 'Automation', pattern: /^(?:create routine|new routine|morning routine|daily routine)\s*(.+)?/i, desc: 'Create a multi-step routine', handler: (m) => ({ reply: `Creating routine${m[1] ? ': ' + m[1] : ''}…`, actions: [{ type: 'create-routine', desc: m[1] || '' }] }) },
  { id: 'run-workflow', cat: 'Automation', pattern: /^(?:run workflow|execute workflow|trigger workflow)\s+(.+)/i, desc: 'Run a saved workflow', handler: (m) => ({ reply: `Running workflow: ${m[1]}`, actions: [{ type: 'run-workflow', name: m[1] }] }) },
  { id: 'save-workflow', cat: 'Automation', pattern: /^(?:save (?:as )?workflow|remember this|save skill|create skill)\s+["']?(.+?)["']?\s*$/i, desc: 'Save current steps as a reusable workflow', handler: (m) => ({ reply: `Saved as workflow: "${m[1]}"`, actions: [{ type: 'save-workflow', name: m[1] }] }) },
  { id: 'monitor-page', cat: 'Automation', pattern: /^(?:monitor|watch|track changes?)\s+(.+)/i, desc: 'Monitor a page for changes', handler: (m) => ({ reply: `Monitoring: ${m[1]}`, actions: [{ type: 'monitor', target: m[1] }] }) },
  { id: 'wait', cat: 'Automation', pattern: /^wait\s+(\d+)\s*(?:s|sec|seconds?|ms)?/i, desc: 'Wait for a specified time', handler: (m) => ({ reply: `Waiting ${m[1]}s…`, actions: [{ type: 'wait', ms: parseInt(m[1]) * 1000 }] }) },

  // ─── Productivity (14) ───
  { id: 'calculate', cat: 'Productivity', pattern: /^(?:calc|calculate|math|compute)\s+(.+)/i, desc: 'Calculate a math expression', handler: (m) => { try { const r = Function('"use strict"; return (' + m[1].replace(/[^0-9+\-*/.()%\s]/g,'') + ')')(); return { reply: `${m[1]} = ${r}` }; } catch { return { reply: `Could not calculate: ${m[1]}` }; } } },
  { id: 'convert-units', cat: 'Productivity', pattern: /^convert\s+(\d+\.?\d*)\s+(\w+)\s+to\s+(\w+)/i, desc: 'Convert between units', handler: (m) => ({ reply: `Converting ${m[1]} ${m[2]} to ${m[3]}…`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=${m[1]}+${m[2]}+to+${m[3]}` }] }) },
  { id: 'weather', cat: 'Productivity', pattern: /^(?:weather|forecast|temperature)\s*(?:in|for|at)?\s*(.+)?/i, desc: 'Check weather forecast', handler: (m) => ({ reply: `Checking weather${m[1] ? ' in ' + m[1] : ''}…`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=weather+${encodeURIComponent(m[1] || '')}` }] }) },
  { id: 'timer', cat: 'Productivity', pattern: /^(?:set timer|timer)\s+(\d+)\s*(?:min|minutes?|sec|seconds?|hrs?|hours?)/i, desc: 'Set a countdown timer', handler: (m) => ({ reply: `Timer set: ${m[1]} ${m[0].match(/min|sec|hr/i)?.[0] || 'min'}`, actions: [{ type: 'timer', duration: m[1], unit: m[0].match(/min|sec|hr/i)?.[0] || 'min' }] }) },
  { id: 'create-note', cat: 'Productivity', pattern: /^(?:note|create note|save note|jot down)\s+(.+)/i, desc: 'Create a quick note', handler: (m) => ({ reply: `Note saved: ${m[1]}`, actions: [{ type: 'save-note', text: m[1] }] }) },
  { id: 'list-notes', cat: 'Productivity', pattern: /^(?:list notes?|show notes?|my notes?)/i, desc: 'List saved notes', handler: () => ({ reply: 'Listing notes…', actions: [{ type: 'list-notes' }] }) },
  { id: 'create-todo', cat: 'Productivity', pattern: /^(?:todo|add todo|add task|task|create task)\s+(.+)/i, desc: 'Add a todo item', handler: (m) => ({ reply: `Todo added: ${m[1]}`, actions: [{ type: 'save-note', text: `TODO: ${m[1]}` }] }) },
  { id: 'bookmark', cat: 'Productivity', pattern: /^(?:bookmark|save page|save this page)/i, desc: 'Bookmark the current page', handler: () => ({ reply: 'Bookmarking page…', actions: [{ type: 'bookmark' }] }) },
  { id: 'qr-code', cat: 'Productivity', pattern: /^(?:qr code|generate qr|qr)\s+(.+)/i, desc: 'Generate a QR code', handler: (m) => ({ reply: `Generating QR code…`, actions: [{ type: 'navigate', url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(m[1])}` }] }) },
  { id: 'shorten-url', cat: 'Productivity', pattern: /^(?:shorten url|short link|shorten)\s+(https?:\/\/.+)/i, desc: 'Shorten a URL', handler: (m) => ({ reply: `URL noted: ${m[1]}. Use a URL shortener service to shorten it.` }) },
  { id: 'random-number', cat: 'Productivity', pattern: /^(?:random number|roll dice|flip coin|random)\s*(.+)?/i, desc: 'Generate random number or flip a coin', handler: (m) => { if (/coin|flip/i.test(m[0])) return { reply: Math.random() > 0.5 ? 'Heads!' : 'Tails!' }; if (/dice|die/i.test(m[0])) return { reply: `You rolled: ${Math.floor(Math.random() * 6) + 1}` }; const max = parseInt(m[1]) || 100; return { reply: `Random number (1-${max}): ${Math.floor(Math.random() * max) + 1}` }; } },
  { id: 'date-time', cat: 'Productivity', pattern: /^(?:what time|current time|what.?s the time|what.?s the date|today.?s date|date today)/i, desc: 'Show current date and time', handler: () => ({ reply: `Current date/time: ${new Date().toLocaleString()}` }) },
  { id: 'countdown', cat: 'Productivity', pattern: /^(?:countdown to|days until|how (?:many|long) until)\s+(.+)/i, desc: 'Countdown to a date', handler: (m) => { try { const d = new Date(m[1]); const diff = Math.ceil((d - Date.now()) / 86400000); return { reply: `${diff} days until ${m[1]}` }; } catch { return { reply: `I couldn't parse the date: ${m[1]}` }; } } },
  { id: 'timezone', cat: 'Productivity', pattern: /^(?:time in|timezone|what time in)\s+(.+)/i, desc: 'Check time in different timezone', handler: (m) => ({ reply: `Checking time in ${m[1]}…`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=time+in+${encodeURIComponent(m[1])}` }] }) },

  // ─── Development (10) ───
  { id: 'test-api', cat: 'Development', pattern: /^(?:test api|api test|curl|fetch)\s+(https?:\/\/.+)/i, desc: 'Test an API endpoint', handler: (m) => ({ reply: `Testing API: ${m[1]}…`, actions: [{ type: 'api-call', url: m[1], method: 'GET' }] }) },
  { id: 'format-json', cat: 'Development', pattern: /^(?:format json|prettify json|pretty print)\s+(.+)/i, desc: 'Format/prettify JSON', handler: (m) => { try { return { reply: '```json\n' + JSON.stringify(JSON.parse(m[1]), null, 2) + '\n```' }; } catch { return { reply: 'Invalid JSON' }; } } },
  { id: 'encode-url', cat: 'Development', pattern: /^(?:url encode|encode url|urlencode)\s+(.+)/i, desc: 'URL-encode a string', handler: (m) => ({ reply: `Encoded: ${encodeURIComponent(m[1])}` }) },
  { id: 'decode-url', cat: 'Development', pattern: /^(?:url decode|decode url|urldecode)\s+(.+)/i, desc: 'URL-decode a string', handler: (m) => ({ reply: `Decoded: ${decodeURIComponent(m[1])}` }) },
  { id: 'base64-encode', cat: 'Development', pattern: /^(?:base64 encode|encode base64|btoa)\s+(.+)/i, desc: 'Base64 encode a string', handler: (m) => ({ reply: `Base64: ${Buffer.from(m[1]).toString('base64')}` }) },
  { id: 'base64-decode', cat: 'Development', pattern: /^(?:base64 decode|decode base64|atob)\s+(.+)/i, desc: 'Base64 decode a string', handler: (m) => { try { return { reply: `Decoded: ${Buffer.from(m[1], 'base64').toString('utf8')}` }; } catch { return { reply: 'Invalid base64' }; } } },
  { id: 'hash-text', cat: 'Development', pattern: /^(?:hash|sha256|md5|sha1)\s+(.+)/i, desc: 'Hash a string', handler: (m) => { const algo = /md5/i.test(m[0]) ? 'md5' : /sha1/i.test(m[0]) ? 'sha1' : 'sha256'; return { reply: `${algo}: ${crypto.createHash(algo).update(m[1]).digest('hex')}` }; } },
  { id: 'uuid', cat: 'Development', pattern: /^(?:uuid|generate uuid|new uuid|guid)/i, desc: 'Generate a UUID', handler: () => ({ reply: `UUID: ${crypto.randomUUID()}` }) },
  { id: 'run-js', cat: 'Development', pattern: /^(?:run js|execute js|javascript|eval)\s+(.+)/i, desc: 'Execute JavaScript on the page', handler: (m) => ({ reply: `Executing JS…`, actions: [{ type: 'run-js', code: m[1] }] }) },
  { id: 'check-console', cat: 'Development', pattern: /^(?:console|check console|console errors?|page errors?)/i, desc: 'Check page console errors', handler: () => ({ reply: 'Checking console…', actions: [{ type: 'check-console' }] }) },

  // ─── Social Media (8) ───
  { id: 'open-twitter', cat: 'Social', pattern: /^(?:open|go to)\s+(?:twitter|x)\s+(?:profile\s+)?@?(.+)/i, desc: 'Open a Twitter/X profile', handler: (m) => ({ reply: `Opening X profile: ${m[1]}`, actions: [{ type: 'navigate', url: `https://x.com/${m[1].replace(/^@/, '')}` }] }) },
  { id: 'open-linkedin', cat: 'Social', pattern: /^(?:open|go to)\s+linkedin\s+(.+)/i, desc: 'Search LinkedIn', handler: (m) => ({ reply: `Searching LinkedIn: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(m[1])}` }] }) },
  { id: 'open-instagram', cat: 'Social', pattern: /^(?:open|go to)\s+instagram\s+@?(.+)/i, desc: 'Open Instagram profile', handler: (m) => ({ reply: `Opening Instagram: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.instagram.com/${m[1].replace(/^@/, '')}` }] }) },
  { id: 'monitor-hashtag', cat: 'Social', pattern: /^(?:monitor hashtag|track hashtag|follow hashtag)\s+#?(.+)/i, desc: 'Monitor a hashtag', handler: (m) => ({ reply: `Monitoring #${m[1]}`, actions: [{ type: 'navigate', url: `https://x.com/search?q=%23${encodeURIComponent(m[1])}&f=live` }] }) },
  { id: 'post-compose', cat: 'Social', pattern: /^(?:compose post|new post|create post)\s+(.+)/i, desc: 'Compose a social media post', handler: (m) => ({ reply: `Composing post…`, actions: [{ type: 'llm-task', task: 'compose-social-post', prompt: m[1] }] }) },
  { id: 'open-github-profile', cat: 'Social', pattern: /^(?:github profile|github user)\s+(.+)/i, desc: 'Open GitHub profile', handler: (m) => ({ reply: `Opening GitHub: ${m[1]}`, actions: [{ type: 'navigate', url: `https://github.com/${encodeURIComponent(m[1])}` }] }) },
  { id: 'product-hunt', cat: 'Social', pattern: /^(?:product hunt|producthunt)\s*(.+)?/i, desc: 'Browse Product Hunt', handler: (m) => ({ reply: `Opening Product Hunt${m[1] ? ': ' + m[1] : ''}`, actions: [{ type: 'navigate', url: m[1] ? `https://www.producthunt.com/search?q=${encodeURIComponent(m[1])}` : 'https://www.producthunt.com' }] }) },
  { id: 'hacker-news', cat: 'Social', pattern: /^(?:hacker news|hn|hackernews)\s*(.+)?/i, desc: 'Browse Hacker News', handler: (m) => ({ reply: `Opening Hacker News`, actions: [{ type: 'navigate', url: m[1] ? `https://hn.algolia.com/?q=${encodeURIComponent(m[1])}` : 'https://news.ycombinator.com' }] }) },

  // ─── Cookie & Session (4) ───
  { id: 'grab-cookies', cat: 'Session', pattern: /^(?:grab cookies?|get cookies?|capture cookies?)\s*(?:for\s+)?(.+)?/i, desc: 'Capture browser cookies for a domain', handler: (m) => ({ reply: `Grabbing cookies${m[1] ? ' for ' + m[1] : ''}…`, actions: [{ type: 'cookie-grab', domain: m[1] || '' }] }) },
  { id: 'clear-cookies', cat: 'Session', pattern: /^(?:clear cookies?|delete cookies?)/i, desc: 'Clear cookies for current site', handler: () => ({ reply: 'Clearing cookies…', actions: [{ type: 'clear-cookies' }] }) },
  { id: 'clear-cache', cat: 'Session', pattern: /^(?:clear cache|clear browser cache|clear data)/i, desc: 'Clear browser cache', handler: () => ({ reply: 'To clear cache: Settings > Privacy > Clear browsing data', actions: [{ type: 'navigate', url: 'chrome://settings/clearBrowserData' }] }) },
  { id: 'incognito', cat: 'Session', pattern: /^(?:incognito|private|private window)/i, desc: 'Open incognito window', handler: () => ({ reply: 'Opening incognito window…', actions: [{ type: 'incognito' }] }) },

  // ─── Memory & Learning (8) ───
  { id: 'remember', cat: 'Memory', pattern: /^(?:remember|save|store)\s+(?:that\s+)?(.+)/i, desc: 'Remember a fact for future use', handler: (m) => ({ reply: `Remembered: ${m[1]}`, actions: [{ type: 'remember', text: m[1] }] }) },
  { id: 'recall', cat: 'Memory', pattern: /^(?:recall|what did i|do you remember|what (?:do you|did you) (?:know|remember))\s*(.+)?/i, desc: 'Recall saved memories', handler: (m) => ({ reply: 'Searching memories…', actions: [{ type: 'recall', query: m[1] || '' }] }) },
  { id: 'forget', cat: 'Memory', pattern: /^(?:forget|clear memory|delete memory|erase memory)\s*(.+)?/i, desc: 'Clear saved memories', handler: (m) => ({ reply: `Memory cleared${m[1] ? ': ' + m[1] : ''}`, actions: [{ type: 'forget', query: m[1] || '' }] }) },
  { id: 'learn-page', cat: 'Memory', pattern: /^(?:learn from|study|memorize)\s+(?:this\s+)?page/i, desc: 'Learn and remember page content', handler: () => ({ reply: 'Learning from this page…', actions: [{ type: 'learn-page' }] }) },
  { id: 'list-skills', cat: 'Memory', pattern: /^(?:list skills?|show skills?|what can you do|help|skills?|commands?|capabilities)/i, desc: 'List all available skills', handler: () => {
    const cats = {};
    SKILLS.forEach(s => { if (!cats[s.cat]) cats[s.cat] = []; cats[s.cat].push(s); });
    let text = `**AMI Agent Skills (${SKILLS.length} total)**\n\n`;
    for (const [cat, skills] of Object.entries(cats)) {
      text += `**${cat}** (${skills.length})\n`;
      skills.forEach(s => { text += `  • \`${s.id}\` — ${s.desc}\n`; });
      text += '\n';
    }
    return { reply: text };
  }},
  { id: 'list-workflows', cat: 'Memory', pattern: /^(?:list workflows?|show workflows?|my workflows?|saved workflows?)/i, desc: 'List saved workflows', handler: () => ({ reply: 'Listing saved workflows…', actions: [{ type: 'list-workflows' }] }) },
  { id: 'show-history', cat: 'Memory', pattern: /^(?:history|chat history|show history|past conversations?)/i, desc: 'Show chat history', handler: () => ({ reply: 'Showing recent history…', actions: [{ type: 'show-history' }] }) },
  { id: 'export-chat', cat: 'Memory', pattern: /^(?:export chat|save chat|download chat)/i, desc: 'Export chat conversation', handler: () => ({ reply: 'Exporting chat…', actions: [{ type: 'export-chat' }] }) },

  // ─── File Generation (4) ───
  { id: 'generate-file', cat: 'File', pattern: /^(?:generate|create|make|write)\s+(?:a\s+)?file\s+(?:named?\s+)?["']?(.+?)["']?\s*$/i, desc: 'Generate and download a file', handler: (m) => ({ reply: `Generating file: ${m[1]}`, actions: [{ type: 'generate-file', filename: m[1], content: '', mime: 'text/plain' }] }) },
  { id: 'generate-csv', cat: 'File', pattern: /^(?:generate|create|export)\s+(?:a\s+)?csv\s+(?:of\s+)?(.+)/i, desc: 'Generate a CSV file', handler: (m) => ({ reply: `Generating CSV: ${m[1]}`, actions: [{ type: 'llm-task', task: 'generate-csv', prompt: m[1] }] }) },
  { id: 'generate-json', cat: 'File', pattern: /^(?:generate|create|export)\s+(?:a\s+)?json\s+(?:of\s+)?(.+)/i, desc: 'Generate a JSON file', handler: (m) => ({ reply: `Generating JSON: ${m[1]}`, actions: [{ type: 'llm-task', task: 'generate-json', prompt: m[1] }] }) },
  { id: 'generate-markdown', cat: 'File', pattern: /^(?:generate|create|write)\s+(?:a\s+)?(?:markdown|md)\s+(?:of\s+|for\s+)?(.+)/i, desc: 'Generate a Markdown file', handler: (m) => ({ reply: `Generating Markdown: ${m[1]}`, actions: [{ type: 'llm-task', task: 'generate-markdown', prompt: m[1] }] }) },

  // ─── Persona & Auto-fill (3) ───
  { id: 'auto-fill', cat: 'Persona', pattern: /^(?:auto.?fill|fill (?:with|using) (?:my|persona)|use my (?:data|info|details|profile))/i, desc: 'Auto-fill forms using your persona', handler: () => ({ reply: 'Auto-filling forms from your persona…', actions: [{ type: 'auto-fill' }] }) },
  { id: 'my-persona', cat: 'Persona', pattern: /^(?:my persona|show persona|who am i|my (?:profile|info|details|identity))/i, desc: 'Show your stored persona', handler: () => ({ reply: 'Fetching your persona…', actions: [{ type: 'show-persona' }] }) },
  { id: 'copy-text', cat: 'Utility', pattern: /^copy\s+["']?(.+?)["']?\s*$/i, desc: 'Copy text to clipboard', handler: (m) => ({ reply: `Copied: "${m[1]}"`, actions: [{ type: 'copy', text: m[1] }] }) },

  // ─── Data Parsing (6) ───
  { id: 'parse-json', cat: 'Data', pattern: /^(?:parse json|read json|decode json)\s+(.+)/i, desc: 'Parse and display JSON data', handler: (m) => { try { return { reply: '```json\n' + JSON.stringify(JSON.parse(m[1]), null, 2) + '\n```' }; } catch { return { reply: 'Invalid JSON input' }; } } },
  { id: 'parse-csv', cat: 'Data', pattern: /^(?:parse csv|read csv|decode csv)\s+(.+)/i, desc: 'Parse CSV data into readable format', handler: (m) => ({ reply: 'Parsing CSV…', actions: [{ type: 'llm-task', task: 'parse-csv', prompt: m[1] }] }) },
  { id: 'extract-json-from-page', cat: 'Data', pattern: /^(?:extract json|scrape json|get json)\s*(?:from)?\s*(?:this)?\s*page/i, desc: 'Extract JSON-LD and structured data from page', handler: () => ({ reply: 'Extracting JSON data from page…', actions: [{ type: 'extract-structured' }] }) },
  { id: 'convert-to-csv', cat: 'Data', pattern: /^(?:convert to csv|table to csv|export as csv)\s*(.+)?/i, desc: 'Convert page table data to CSV', handler: (m) => ({ reply: 'Converting to CSV…', actions: [{ type: 'extract-table' }] }) },
  { id: 'parse-url', cat: 'Data', pattern: /^(?:parse url|decode url|analyze url)\s+(https?:\/\/.+)/i, desc: 'Parse and display URL components', handler: (m) => { try { const u = new URL(m[1]); return { reply: `**URL Analysis**\nProtocol: ${u.protocol}\nHost: ${u.host}\nPath: ${u.pathname}\nQuery: ${u.search}\nHash: ${u.hash}` }; } catch { return { reply: 'Invalid URL' }; } } },
  { id: 'word-count', cat: 'Data', pattern: /^(?:word count|count words|character count)\s+(.+)/i, desc: 'Count words and characters in text', handler: (m) => ({ reply: `Words: ${m[1].split(/\s+/).filter(Boolean).length} | Characters: ${m[1].length} | Lines: ${m[1].split('\n').length}` }) },

  // ─── Security & Privacy (6) ───
  { id: 'check-breach', cat: 'Security', pattern: /^(?:check breach|have i been pwned|data breach|check password)\s+(.+)/i, desc: 'Check if email was in a data breach', handler: (m) => ({ reply: `Checking breach status for ${m[1]}…`, actions: [{ type: 'navigate', url: `https://haveibeenpwned.com/account/${encodeURIComponent(m[1])}` }] }) },
  { id: 'generate-password', cat: 'Security', pattern: /^(?:generate password|new password|random password|strong password)/i, desc: 'Generate a strong random password', handler: () => { const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*'; let p = ''; for (let i = 0; i < 24; i++) p += c[Math.floor(Math.random() * c.length)]; return { reply: `Generated password: \`${p}\`` }; } },
  { id: 'check-ssl', cat: 'Security', pattern: /^(?:check ssl|ssl check|certificate check)\s+(.+)/i, desc: 'Check SSL certificate for a domain', handler: (m) => ({ reply: `Checking SSL for ${m[1]}…`, actions: [{ type: 'navigate', url: `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(m[1])}` }] }) },
  { id: 'whois', cat: 'Security', pattern: /^(?:whois|domain info|lookup domain)\s+(.+)/i, desc: 'WHOIS lookup for a domain', handler: (m) => ({ reply: `Looking up: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.whois.com/whois/${encodeURIComponent(m[1])}` }] }) },
  { id: 'dns-lookup', cat: 'Security', pattern: /^(?:dns lookup|check dns|dig)\s+(.+)/i, desc: 'DNS lookup for a domain', handler: (m) => ({ reply: `DNS lookup: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.nslookup.io/domains/${encodeURIComponent(m[1])}/dns-records/` }] }) },
  { id: 'privacy-check', cat: 'Security', pattern: /^(?:privacy check|check trackers|privacy scan)/i, desc: 'Check privacy and trackers on current page', handler: () => ({ reply: 'Scanning for trackers…', actions: [{ type: 'privacy-scan' }] }) },

  // ─── Education & Learning (6) ───
  { id: 'flashcards', cat: 'Education', pattern: /^(?:flashcards?|make flashcards?|study cards?)\s+(?:for\s+)?(.+)/i, desc: 'Generate flashcards for a topic', handler: (m) => ({ reply: `Generating flashcards: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'flashcards', prompt: m[1] }] }) },
  { id: 'quiz', cat: 'Education', pattern: /^(?:quiz|test me|pop quiz)\s+(?:on\s+)?(.+)/i, desc: 'Create a quiz on a topic', handler: (m) => ({ reply: `Creating quiz: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'quiz', prompt: m[1] }] }) },
  { id: 'eli5', cat: 'Education', pattern: /^(?:eli5|explain like i.?m 5|simple explanation)\s+(.+)/i, desc: 'Explain like I\'m 5', handler: (m) => ({ reply: `Explaining simply: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'eli5', prompt: m[1] }] }) },
  { id: 'study-plan', cat: 'Education', pattern: /^(?:study plan|learning plan|roadmap)\s+(?:for\s+)?(.+)/i, desc: 'Create a study plan', handler: (m) => ({ reply: `Creating study plan: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'study-plan', prompt: m[1] }] }) },
  { id: 'teach-me', cat: 'Education', pattern: /^(?:teach me|tutorial|lesson)\s+(.+)/i, desc: 'Teach me about a topic', handler: (m) => ({ reply: `Teaching: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'teach', prompt: m[1] }] }) },
  { id: 'practice-problems', cat: 'Education', pattern: /^(?:practice problems?|exercises?|drill)\s+(?:for\s+)?(.+)/i, desc: 'Generate practice problems', handler: (m) => ({ reply: `Generating practice: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'practice', prompt: m[1] }] }) },

  // ─── Health & Wellness (4) ───
  { id: 'pomodoro', cat: 'Wellness', pattern: /^(?:pomodoro|focus timer|start timer|work timer)(?:\s+(\d+))?/i, desc: 'Start a Pomodoro focus timer', handler: (m) => { const mins = m[1] || '25'; return { reply: `Pomodoro timer set for ${mins} minutes. Focus!`, actions: [{ type: 'timer', minutes: parseInt(mins) }] }; } },
  { id: 'break-reminder', cat: 'Wellness', pattern: /^(?:break|take a break|remind me to break|eye break)/i, desc: 'Set a break reminder', handler: () => ({ reply: '⏰ Break reminder set. I\'ll remind you in 20 minutes.', actions: [{ type: 'timer', minutes: 20, message: 'Time for a break! Stand up, stretch, and rest your eyes.' }] }) },
  { id: 'stretch', cat: 'Wellness', pattern: /^(?:stretch|stretching|desk exercises?|ergonomic)/i, desc: 'Get desk stretching exercises', handler: () => ({ reply: 'Generating desk exercise routine…', actions: [{ type: 'llm-task', task: 'stretch-routine' }] }) },
  { id: 'breathe', cat: 'Wellness', pattern: /^(?:breathe|breathing exercise|calm down|relax|deep breath)/i, desc: 'Guided breathing exercise', handler: () => ({ reply: '🧘 4-7-8 Breathing:\n1. Breathe in through nose for 4 seconds\n2. Hold for 7 seconds\n3. Exhale through mouth for 8 seconds\nRepeat 3-4 cycles.' }) },

  // ─── Travel & Location (4) ───
  { id: 'weather', cat: 'Travel', pattern: /^(?:weather|forecast|temperature)\s+(?:in\s+|for\s+|at\s+)?(.+)/i, desc: 'Check weather for a location', handler: (m) => ({ reply: `Checking weather: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=weather+${encodeURIComponent(m[1])}` }] }) },
  { id: 'directions', cat: 'Travel', pattern: /^(?:directions?|route|how to get)\s+(?:to\s+|from\s+)?(.+)/i, desc: 'Get directions to a place', handler: (m) => ({ reply: `Getting directions: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/maps/dir//${encodeURIComponent(m[1])}` }] }) },
  { id: 'flight-status', cat: 'Travel', pattern: /^(?:flight status|track flight|flight)\s+(.+)/i, desc: 'Check flight status', handler: (m) => ({ reply: `Checking flight: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=flight+status+${encodeURIComponent(m[1])}` }] }) },
  { id: 'timezone', cat: 'Travel', pattern: /^(?:time(?:zone)?|what time)\s+(?:in\s+|is it in\s+)?(.+)/i, desc: 'Check time in a timezone or city', handler: (m) => ({ reply: `Checking time in ${m[1]}…`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=time+in+${encodeURIComponent(m[1])}` }] }) },

  // ─── Math & Conversion (4) ───
  { id: 'calculate', cat: 'Math', pattern: /^(?:calc(?:ulate)?|compute|math|solve)\s+(.+)/i, desc: 'Calculate a math expression', handler: (m) => ({ reply: `Calculating: ${m[1]}…`, actions: [{ type: 'llm-task', task: 'calculate', prompt: m[1] }] }) },
  { id: 'convert-units', cat: 'Math', pattern: /^convert\s+(.+)/i, desc: 'Convert units or currencies', handler: (m) => ({ reply: `Converting: ${m[1]}…`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=convert+${encodeURIComponent(m[1])}` }] }) },
  { id: 'exchange-rate', cat: 'Math', pattern: /^(?:exchange rate|forex|currency rate)\s+(.+)/i, desc: 'Check currency exchange rate', handler: (m) => ({ reply: `Checking rate: ${m[1]}`, actions: [{ type: 'navigate', url: `https://www.google.com/search?q=${encodeURIComponent(m[1])}+exchange+rate` }] }) },
  { id: 'random-number', cat: 'Math', pattern: /^(?:random number|roll dice|flip coin|rng)(?:\s+(\d+)\s*-\s*(\d+))?/i, desc: 'Generate random number or flip coin', handler: (m) => { const min = parseInt(m[1]) || 1; const max = parseInt(m[2]) || 100; const val = Math.floor(Math.random() * (max - min + 1)) + min; return { reply: `🎲 Random number (${min}-${max}): **${val}**` }; } },

  // ─── System (8) ───
  { id: 'settings', cat: 'System', pattern: /^(?:settings|preferences|config|configure)/i, desc: 'Open settings', handler: () => ({ reply: 'Opening settings…', actions: [{ type: 'open-settings' }] }) },
  { id: 'connections', cat: 'System', pattern: /^(?:connections|integrations|connected apps|manage connections)/i, desc: 'Manage connections', handler: () => ({ reply: 'Opening connections…', actions: [{ type: 'open-connections' }] }) },
  { id: 'status', cat: 'System', pattern: /^(?:status|system status|health check|check status)/i, desc: 'Check system status', handler: () => ({ reply: 'Checking system status…', actions: [{ type: 'check-status' }] }) },
  { id: 'version', cat: 'System', pattern: /^(?:version|about|what version)/i, desc: 'Show AMI Browser version', handler: () => ({ reply: 'AMI Browser v2.0.0 — AI-powered automation browser with 210+ built-in skills and 240+ integrations.' }) },
  { id: 'clear-chat', cat: 'System', pattern: /^(?:clear chat|new chat|reset chat|fresh start)/i, desc: 'Clear chat history', handler: () => ({ reply: 'Chat cleared.', actions: [{ type: 'clear-chat' }] }) },
  { id: 'theme', cat: 'System', pattern: /^(?:theme|dark mode|light mode|toggle theme)/i, desc: 'Toggle dark/light theme', handler: () => ({ reply: 'Toggling theme…', actions: [{ type: 'toggle-theme' }] }) },
  { id: 'fullscreen', cat: 'System', pattern: /^(?:fullscreen|full screen|maximize)/i, desc: 'Toggle fullscreen', handler: () => ({ reply: 'Toggling fullscreen…', actions: [{ type: 'fullscreen' }] }) },
  { id: 'open-hub', cat: 'System', pattern: /^(?:hub|home|ami hub|dashboard|goto? hub|open hub)/i, desc: 'Open AMI Browser hub page', handler: () => ({ reply: 'Opening AMI Hub…', actions: [{ type: 'open-hub' }] }) },
];

/* ── Skills API endpoint ── */
function getSkillsPayload() {
  return SKILLS.map(s => ({ id: s.id, cat: s.cat, desc: s.desc }));
}

/* Build dynamic system context listing available connections & capabilities */
function buildConnectionContext() {
  if (!savedConnections.length) return '';
  const lines = savedConnections.map(c => {
    const cat = PROVIDER_CATALOG.find(p => p.id === c.provider);
    return `  - ${c.name} (${cat?.label || c.provider}, id: ${c.id})`;
  });
  return `\n\nAVAILABLE CONNECTIONS (saved API keys the user configured):\n${lines.join('\n')}\n\nYou can use these connections in your actions:\n- To call a third-party API with a saved credential, emit action: {"type":"api-call","provider":"<provider_id>","url":"https://...","method":"GET|POST","headers":{},"body":{}}\n  The gateway will auto-inject the stored API key as Bearer token.\n- To grab browser cookies for an authenticated session, emit action: {"type":"cookie-grab","domain":"example.com"}\n  This captures the user's logged-in session cookies for that domain.\n- For app.ami.finance / Arena actions, use provider "arena" with the Arena API.\n\nAlways prefer using saved connections over asking the user for credentials.`;
}

async function processChat(message, config, history, pageContext) {
  const lower = (message || '').toLowerCase().trim();

  // ── Compound intent detection: "go to X and do Y" ──
  const compoundMatch = lower.match(/^(?:go to|open|visit|navigate to?)\s+(\S+?)(?:\.com|\.org|\.net|\.io)?\s+(?:and|then|to)\s+(.+)$/i);
  if (compoundMatch) {
    const site = compoundMatch[1].replace(/\.$/, '');
    const rawTask = compoundMatch[2].trim();
    // Strip action verbs from the task for cleaner search queries (longer matches first)
    const task = rawTask.replace(/^(?:search for|look for|look up|listen to|play|search|watch|find|browse|type|enter)\s+/i, '').trim() || rawTask;
    const siteMap = {
      youtube: 'https://www.youtube.com', spotify: 'https://open.spotify.com',
      google: 'https://www.google.com', github: 'https://github.com',
      twitter: 'https://x.com', x: 'https://x.com', reddit: 'https://www.reddit.com',
      linkedin: 'https://www.linkedin.com', amazon: 'https://www.amazon.com',
      facebook: 'https://www.facebook.com', instagram: 'https://www.instagram.com',
      netflix: 'https://www.netflix.com', twitch: 'https://www.twitch.tv',
      soundcloud: 'https://soundcloud.com', stackoverflow: 'https://stackoverflow.com',
      npm: 'https://www.npmjs.com', ebay: 'https://www.ebay.com',
      imdb: 'https://www.imdb.com', pinterest: 'https://www.pinterest.com',
    };
    const baseUrl = siteMap[site] || `https://${site}.com`;
    // Build search URL if the site supports it
    const searchUrls = {
      youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(task)}`,
      spotify: `https://open.spotify.com/search/${encodeURIComponent(task)}`,
      google: `https://www.google.com/search?q=${encodeURIComponent(task)}`,
      github: `https://github.com/search?q=${encodeURIComponent(task)}`,
      twitter: `https://x.com/search?q=${encodeURIComponent(task)}`,
      x: `https://x.com/search?q=${encodeURIComponent(task)}`,
      reddit: `https://www.reddit.com/search/?q=${encodeURIComponent(task)}`,
      amazon: `https://www.amazon.com/s?k=${encodeURIComponent(task)}`,
      soundcloud: `https://soundcloud.com/search?q=${encodeURIComponent(task)}`,
      stackoverflow: `https://stackoverflow.com/search?q=${encodeURIComponent(task)}`,
      npm: `https://www.npmjs.com/search?q=${encodeURIComponent(task)}`,
      ebay: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(task)}`,
      imdb: `https://www.imdb.com/find/?q=${encodeURIComponent(task)}`,
      netflix: `https://www.netflix.com/search?q=${encodeURIComponent(task)}`,
      twitch: `https://www.twitch.tv/search?term=${encodeURIComponent(task)}`,
      pinterest: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(task)}`,
    };
    const url = searchUrls[site] || `${baseUrl}/search?q=${encodeURIComponent(task)}`;
    const verb = /play|listen|watch|put on/i.test(rawTask) ? 'Playing' : 'Searching';
    // Build follow-up actions: dismiss cookie consent, then click first result
    const followUp = [];
    followUp.push({ type: 'dismiss-cookies', delay: 1500 });
    if (/play|listen|watch|put on/i.test(rawTask)) {
      followUp.push({ type: 'click', selector: 'first result', delay: 2500 });
    }
    console.log(`[gateway] compound-intent: site=${site} task=${task} verb=${verb} url=${url} followUps=${followUp.length}`);
    return { reply: `${verb} on ${site}: ${task}`, actions: [{ type: 'navigate', url, followUp }] };
  }

  // ── Play music / video intent ──
  const playMatch = lower.match(/^(?:play|listen to|watch|put on|queue)\s+(.+?)(?:\s+on\s+(youtube|spotify|soundcloud|apple music|deezer|twitch|netflix))?$/i);
  if (playMatch) {
    const query = playMatch[1].trim();
    const platform = (playMatch[2] || '').toLowerCase();
    if (platform === 'spotify') {
      return { reply: `Searching Spotify for: ${query}`, actions: [{ type: 'navigate', url: `https://open.spotify.com/search/${encodeURIComponent(query)}` }] };
    }
    if (platform === 'soundcloud') {
      return { reply: `Searching SoundCloud for: ${query}`, actions: [{ type: 'navigate', url: `https://soundcloud.com/search?q=${encodeURIComponent(query)}` }] };
    }
    if (platform === 'netflix') {
      return { reply: `Searching Netflix for: ${query}`, actions: [{ type: 'navigate', url: `https://www.netflix.com/search?q=${encodeURIComponent(query)}` }] };
    }
    if (platform === 'twitch') {
      return { reply: `Searching Twitch for: ${query}`, actions: [{ type: 'navigate', url: `https://www.twitch.tv/search?term=${encodeURIComponent(query)}` }] };
    }
    // Default to YouTube for play/watch
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const ytFollowUp = [
      { type: 'dismiss-cookies', delay: 1500 },
      { type: 'click', selector: 'first result', delay: 2500 },
    ];
    console.log(`[gateway] play-intent: query=${query} platform=youtube url=${ytUrl}`);
    return { reply: `Searching YouTube for: ${query}`, actions: [{ type: 'navigate', url: ytUrl, followUp: ytFollowUp }] };
  }

  // ── If we have an LLM and it's a page interaction request with context, use LLM for smart automation ──
  const isPageAction = /click|tap|press|select|choose|pick|find.*button|find.*link|go to.*result|open.*result|\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|next)\b.*(?:result|link|item|button|option|entry)/i.test(lower);
  if (isPageAction && pageContext && config?.provider) {
    try {
      const contextStr = `Page: ${pageContext.title || ''}\nURL: ${pageContext.url || ''}\nHeadings: ${(pageContext.headings || []).join(', ')}\nForms: ${pageContext.forms || 0} | Links: ${pageContext.links || 0}\n${pageContext.selected ? 'Selected text: ' + pageContext.selected : ''}`;
      const smartPrompt = `You are a browser automation agent. The user is on this page:\n${contextStr}\n\nUser request: "${message}"\n\nRespond ONLY with a JSON object like: {"reply": "description of what you're doing", "actions": [{"type": "click", "selector": "CSS_SELECTOR_OR_TEXT"}]}\n\nFor "click on the Nth result" on Google, use selector like "#search .g:nth-of-type(N) a" or the actual link text.\nFor clicking by text, use the visible text as selector.\nFor typing, use: {"type": "type", "selector": "CSS_SELECTOR", "text": "value"}\nFor scrolling: {"type": "scroll", "y": 500}\nRespond ONLY with valid JSON, no markdown.`;
      const llmReply = await callLLM(smartPrompt, config, []);
      // Parse the JSON response
      try {
        const cleaned = llmReply.replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return {
          reply: parsed.reply || `Performing: ${message}`,
          actions: Array.isArray(parsed.actions) ? parsed.actions : (parsed.action ? [parsed.action] : []),
        };
      } catch {
        return parseLLMResponse(llmReply);
      }
    } catch (err) {
      console.warn('[chat] Smart automation LLM failed, falling back to skill match:', err.message);
      // Fall through to skill matching
    }
  }

  // ── Match against built-in skills registry ──
  for (const skill of SKILLS) {
    const match = message.match(skill.pattern);
    if (match) {
      const result = skill.handler(match);
      // For llm-task actions, forward to LLM if configured
      if (result.actions?.some(a => a.type === 'llm-task') && config?.provider && config.provider !== 'none') {
        try {
          const taskAction = result.actions.find(a => a.type === 'llm-task');
          const taskPrompts = {
            'write-email': `Write a professional email: ${taskAction.prompt}`,
            'write-post': `Write an engaging social media post about: ${taskAction.prompt}`,
            'summarize': `Summarize the following in a clear and concise way: ${taskAction.prompt}`,
            'translate': `Translate the following to ${taskAction.lang}: ${taskAction.prompt}`,
            'rewrite': `Rewrite the following text in a different way while keeping the same meaning: ${taskAction.prompt}`,
            'expand': `Expand on the following text with more details and examples: ${taskAction.prompt}`,
            'shorten': `Shorten the following text while keeping key points: ${taskAction.prompt}`,
            'proofread': `Proofread and fix any grammar/spelling errors: ${taskAction.prompt}`,
            'brainstorm': `Generate 10 creative ideas for: ${taskAction.prompt}`,
            'write-code': `Write clean, well-commented code for: ${taskAction.prompt}`,
            'explain-code': `Explain this code in simple terms: ${taskAction.prompt}`,
            'write-regex': `Write a regular expression for: ${taskAction.prompt}. Explain the pattern.`,
            'compare': `Compare the following, listing key differences and similarities: ${taskAction.prompt}`,
            'sentiment': `Analyze the sentiment of: ${taskAction.prompt}. Is it positive, negative, or neutral? Rate confidence.`,
            'fact-check': `Fact-check the following claim: ${taskAction.prompt}. Provide evidence.`,
            'research': `Provide a detailed research summary on: ${taskAction.prompt}`,
            'competitor-analysis': `Analyze the competitive landscape for: ${taskAction.prompt}`,
            'market-research': `Provide market research for: ${taskAction.prompt}`,
            'define': `Define and explain: ${taskAction.prompt}`,
            'how-to': `Provide step-by-step instructions for: ${taskAction.prompt}`,
            'pros-cons': `List the pros and cons of: ${taskAction.prompt}`,
            'explain': `Explain in simple terms: ${taskAction.prompt}`,
            'compose-reply': `Compose a professional reply: ${taskAction.prompt}`,
            'summarize-thread': 'Summarize our conversation so far.',
            'draft-response': `Draft a professional response: ${taskAction.prompt}`,
            'announce': `Create a professional announcement: ${taskAction.prompt}`,
            'compose-social-post': `Create an engaging social media post about: ${taskAction.prompt}. Include relevant hashtags.`,
            'generate-csv': `Generate CSV data for: ${taskAction.prompt}. Return ONLY the CSV content with headers on the first line. No explanations, just raw CSV.`,
            'generate-json': `Generate JSON data for: ${taskAction.prompt}. Return ONLY valid JSON. No explanations, just raw JSON.`,
            'generate-markdown': `Generate a well-structured Markdown document for: ${taskAction.prompt}. Return ONLY the Markdown content.`,
          };
          const prompt = taskPrompts[taskAction.task] || taskAction.prompt || message;
          const llmReply = await callLLM(prompt, config, history);
          return parseLLMResponse(llmReply);
        } catch (err) {
          return { reply: `Skill "${skill.id}" triggered but LLM failed: ${err.message}. ${result.reply}` };
        }
      }
      return result;
    }
  }

  // If LLM config is provided, try to forward to LLM
  if (config && config.provider && config.provider !== 'none') {
    try {
      // Enrich message with page context if available
      let enrichedMessage = message;
      if (pageContext) {
        enrichedMessage = `${message}\n\n[Page context: title="${pageContext.title || ''}", url="${pageContext.url || ''}", headings: ${(pageContext.headings || []).slice(0, 5).join(', ')}, forms: ${pageContext.forms || 0}${pageContext.selected ? ', selected: "' + pageContext.selected.slice(0, 200) + '"' : ''}]`;
      }
      const llmReply = await callLLM(enrichedMessage, config, history);
      return parseLLMResponse(llmReply);
    } catch (err) {
      return { reply: `LLM error: ${err.message}. Try a built-in command like "go to google.com" or "screenshot".` };
    }
  }

  // Default — no LLM available
  const autoConf = getAutoConfig();
  const hint = autoConf
    ? '(Auto-detected API key from .env — this should not happen, please report this bug)'
    : 'To enable smart AI responses, add an API key to `clawsurf-hub/.env`:\n```\nMISTRAL_API_KEY=your-key-here\n```\nOr configure a provider in Agent Config (⚙️).';
  return {
    reply: `I understood: "${message}"\n\nI have **${SKILLS.length} built-in skills**! Try:\n• "go to <url>" — navigate\n• "search <query>" — web search\n• "screenshot" — capture page\n• "extract text/links/emails" — read page data\n• "click <element>" — click on page elements\n• "fill form" — auto-fill forms\n• "summarize" — summarize current page\n• "schedule <task>" — schedule automation\n• "price bitcoin" — crypto prices\n\n${hint}`,
  };
}

/* ══════════════ LLM integration ══════════════ */

/* ── Load .env for API keys ── */
const envPath = path.join(__dirname, '.env');
const envKeys = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)/);
    if (m) envKeys[m[1].trim()] = m[2].trim();
  });
}
function envKey(name) { return envKeys[name] || process.env[name] || ''; }

/* ── Provider chat endpoints ── */
const PROVIDER_ENDPOINTS = {
  openai:     'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  anthropic:  'https://api.anthropic.com/v1/messages',
  gemini:     'https://generativelanguage.googleapis.com/v1beta/models',
  grok:       'https://api.x.ai/v1/chat/completions',
  mistral:    'https://api.mistral.ai/v1/chat/completions',
  deepseek:   'https://api.deepseek.com/v1/chat/completions',
  huggingface:'https://api-inference.huggingface.co/models',
};

/* ── Provider model catalog URLs ── */
const MODEL_CATALOG_URLS = {
  openai:      { url: 'https://api.openai.com/v1/models', needsKey: true },
  openrouter:  { url: 'https://openrouter.ai/api/v1/models', needsKey: false },
  anthropic:   { url: 'https://api.anthropic.com/v1/models', needsKey: true, extra: { 'anthropic-version': '2025-04-01' } },
  gemini:      { url: null, needsKey: true }, // key appended as query param
  grok:        { url: 'https://api.x.ai/v1/models', needsKey: true },
  mistral:     { url: 'https://api.mistral.ai/v1/models', needsKey: true },
  deepseek:    { url: 'https://api.deepseek.com/v1/models', needsKey: true },
  huggingface: { url: 'https://huggingface.co/api/models?pipeline_tag=text-generation&sort=downloads&limit=80', needsKey: false },
};

async function fetchModelCatalog(provider, apiKey) {
  const spec = MODEL_CATALOG_URLS[provider];
  if (!spec) return [];

  let catalogUrl = spec.url;
  const headers = { 'Content-Type': 'application/json' };

  if (provider === 'gemini') {
    if (!apiKey) return [];
    catalogUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  } else if (spec.needsKey) {
    if (!apiKey) return [];
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2025-04-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }
  if (spec.extra) Object.assign(headers, spec.extra);

  const resp = await fetch(catalogUrl, { headers, signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`${provider} catalog ${resp.status}`);
  const data = await resp.json();

  // Normalize to [{id, name}]
  if (provider === 'openrouter' && data.data) {
    return data.data.map(m => ({ id: m.id, name: m.name || m.id }));
  }
  if (provider === 'huggingface') {
    return (Array.isArray(data) ? data : []).map(m => ({ id: m.modelId || m.id, name: m.modelId || m.id }));
  }
  if (provider === 'gemini' && data.models) {
    return data.models.map(m => ({ id: m.name?.replace('models/','') || m.name, name: m.displayName || m.name }));
  }
  if (data.data) {
    return data.data.map(m => ({ id: m.id, name: m.id }));
  }
  return [];
}

async function callLLM(message, config, history) {
  const { provider, apiKey, url: endpoint, model, systemPrompt } = config;

  const sysContent = (systemPrompt || `You are AMI Agent, the AI brain of AMI Browser — a powerful browser automation assistant with ${SKILLS.length}+ built-in skills. You can navigate pages, click elements, type text, fill forms, extract data (text, links, emails, tables, images), take screenshots, generate & download files, auto-fill forms from user persona, schedule tasks, create workflows, manage persistent memories, call third-party APIs, and much more.

When the user asks to perform a browser action, respond with JSON: {"reply":"description","actions":[...]}
Available action types:
- navigate: {"type":"navigate","url":"..."}
- click: {"type":"click","selector":"CSS_SELECTOR_OR_TEXT"}
- type: {"type":"type","selector":"...","text":"..."}
- scroll: {"type":"scroll","y":500}
- screenshot: {"type":"screenshot"}
- extract-text, extract-links, extract-emails, extract-table, extract-images, extract-headings, extract-meta
- fill-form: {"type":"fill-form","data":{"fieldName":"value"}}
- auto-fill: {"type":"auto-fill"} — fills forms using stored persona data
- generate-file: {"type":"generate-file","filename":"name.ext","content":"...","mime":"text/plain"}
- download: {"type":"download","url":"...","filename":"..."}
- copy: {"type":"copy","text":"..."}
- remember: {"type":"remember","text":"..."} — save to persistent memory
- recall: {"type":"recall","query":"..."} — search memories
- summarize-page: {"type":"summarize-page"}
- submit: {"type":"submit"}
- hover, select, highlight, wait

For clicking: prefer CSS selectors. For nth results on search pages use "#search .g:nth-of-type(N) a".
Always be helpful, proactive, and efficient. Respond in the user's language.`) + buildConnectionContext();
  const messages = [
    { role: 'system', content: sysContent },
    ...(history || []).slice(-10),
    { role: 'user', content: message },
  ];

  let apiUrl, headers, body;

  switch (provider) {
    case 'openai':
    case 'openrouter':
    case 'grok':
    case 'mistral':
    case 'deepseek':
      apiUrl = PROVIDER_ENDPOINTS[provider];
      headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      if (provider === 'openrouter') headers['HTTP-Referer'] = 'https://amibrowser.com';
      body = JSON.stringify({ model: model || 'auto', messages, max_tokens: 1024 });
      break;

    case 'anthropic':
      apiUrl = PROVIDER_ENDPOINTS.anthropic;
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2025-04-01', 'Content-Type': 'application/json' };
      body = JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        system: sysContent,
        messages: messages.filter(m => m.role !== 'system'),
        max_tokens: 1024,
      });
      break;

    case 'gemini': {
      const gemModel = model || 'gemini-2.0-flash';
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${gemModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
      headers = { 'Content-Type': 'application/json' };
      const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      body = JSON.stringify({
        systemInstruction: { parts: [{ text: sysContent }] },
        contents,
      });
      break;
    }

    case 'huggingface':
      apiUrl = `https://api-inference.huggingface.co/models/${model || 'mistralai/Mistral-7B-Instruct-v0.3'}`;
      headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      body = JSON.stringify({ inputs: message, parameters: { max_new_tokens: 512 } });
      break;

    case 'ollama':
      apiUrl = (endpoint || 'http://localhost:11434') + '/api/chat';
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({ model: model || 'llama3', messages, stream: false });
      break;

    case 'custom':
      apiUrl = endpoint;
      headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      body = JSON.stringify({ model, messages, max_tokens: 1024 });
      break;

    default:
      throw new Error('Unknown provider: ' + provider);
  }

  const resp = await fetch(apiUrl, { method: 'POST', headers, body });
  if (!resp.ok) throw new Error(`LLM API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();

  // Extract text from different provider response formats
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  if (data.content?.[0]?.text) return data.content[0].text;
  if (data.message?.content) return data.message.content;
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text;
  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
  return JSON.stringify(data);
}

function parseLLMResponse(text) {
  // Try to extract JSON actions from the response
  try {
    const jsonMatch = text.match(/```json\n?([\s\S]*?)```/) || text.match(/\{[\s\S]*"actions?"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      let normalizedActions;
      if (Array.isArray(parsed.actions)) normalizedActions = parsed.actions;
      else if (parsed.action && typeof parsed.action === 'object') normalizedActions = [parsed.action];
      return {
        reply: parsed.reply || parsed.message || text,
        actions: normalizedActions,
      };
    }
  } catch { /* not JSON, that's fine */ }

  return { reply: text };
}

/* ══════════════ Helpers ══════════════ */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/* ══════════════ Connection Testing ══════════════ */
async function testConnection(provider, secret, metadata) {
  const timeout = AbortSignal.timeout(10000);
  try {
    switch (provider) {
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`OpenAI API returned ${r.status}`);
        return { ok: true, message: 'OpenAI API key is valid' };
      }
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': secret, 'anthropic-version': '2025-04-01' }, signal: timeout });
        if (!r.ok) throw new Error(`Anthropic API returned ${r.status}`);
        return { ok: true, message: 'Anthropic API key is valid' };
      }
      case 'gemini': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(secret)}`, { signal: timeout });
        if (!r.ok) throw new Error(`Gemini API returned ${r.status}`);
        return { ok: true, message: 'Gemini API key is valid' };
      }
      case 'mistral': case 'stt_mistral': case 'tts_mistral': {
        const r = await fetch('https://api.mistral.ai/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Mistral API returned ${r.status}`);
        return { ok: true, message: 'Mistral API key is valid' };
      }
      case 'grok': {
        const r = await fetch('https://api.x.ai/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Grok API returned ${r.status}`);
        return { ok: true, message: 'Grok API key is valid' };
      }
      case 'deepseek': {
        const r = await fetch('https://api.deepseek.com/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`DeepSeek API returned ${r.status}`);
        return { ok: true, message: 'DeepSeek API key is valid' };
      }
      case 'openrouter': {
        const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`OpenRouter API returned ${r.status}`);
        return { ok: true, message: 'OpenRouter API key is valid' };
      }
      case 'huggingface': {
        const r = await fetch('https://huggingface.co/api/whoami-v2', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`HuggingFace token returned ${r.status}`);
        return { ok: true, message: 'HuggingFace token is valid' };
      }
      case 'together': {
        const r = await fetch('https://api.together.xyz/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Together AI returned ${r.status}`);
        return { ok: true, message: 'Together AI key is valid' };
      }
      case 'groq': {
        const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Groq API returned ${r.status}`);
        return { ok: true, message: 'Groq API key is valid' };
      }
      case 'perplexity': {
        const r = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }), signal: timeout });
        if (!r.ok) throw new Error(`Perplexity API returned ${r.status}`);
        return { ok: true, message: 'Perplexity API key is valid' };
      }
      case 'cohere': {
        const r = await fetch('https://api.cohere.ai/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Cohere API returned ${r.status}`);
        return { ok: true, message: 'Cohere API key is valid' };
      }
      case 'fireworks': {
        const r = await fetch('https://api.fireworks.ai/inference/v1/models', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Fireworks AI returned ${r.status}`);
        return { ok: true, message: 'Fireworks AI key is valid' };
      }
      case 'replicate': {
        const r = await fetch('https://api.replicate.com/v1/account', { headers: { 'Authorization': `Token ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Replicate API returned ${r.status}`);
        return { ok: true, message: 'Replicate token is valid' };
      }
      case 'telegram': {
        const r = await fetch(`https://api.telegram.org/bot${secret}/getMe`, { signal: timeout });
        const d = await r.json();
        if (!d.ok) throw new Error(d.description || 'Invalid bot token');
        return { ok: true, message: `Telegram Bot: @${d.result.username}` };
      }
      case 'discord': {
        const r = await fetch(secret, { method: 'GET', signal: timeout });
        if (!r.ok) throw new Error(`Discord webhook returned ${r.status}`);
        return { ok: true, message: 'Discord webhook is valid' };
      }
      case 'stripe': {
        const r = await fetch('https://api.stripe.com/v1/balance', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Stripe API returned ${r.status}`);
        return { ok: true, message: 'Stripe API key is valid' };
      }
      case 'sendgrid': {
        const r = await fetch('https://api.sendgrid.com/v3/user/profile', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`SendGrid API returned ${r.status}`);
        return { ok: true, message: 'SendGrid API key is valid' };
      }
      case 'github': {
        const r = await fetch('https://api.github.com/user', { headers: { 'Authorization': `token ${secret}`, 'User-Agent': 'AMI-Browser/2.0' }, signal: timeout });
        if (!r.ok) throw new Error(`GitHub API returned ${r.status}`);
        const d = await r.json();
        return { ok: true, message: `GitHub: ${d.login}` };
      }
      case 'notion': {
        const r = await fetch('https://api.notion.com/v1/users/me', { headers: { 'Authorization': `Bearer ${secret}`, 'Notion-Version': '2022-06-28' }, signal: timeout });
        if (!r.ok) throw new Error(`Notion API returned ${r.status}`);
        return { ok: true, message: 'Notion API key is valid' };
      }
      case 'ollama': case 'lmstudio': {
        let base = 'http://localhost:11434';
        try { if (metadata) { const m = JSON.parse(metadata); if (m.baseUrl) base = m.baseUrl; } } catch {}
        if (provider === 'lmstudio') base = 'http://localhost:1234';
        const r = await fetch(`${base.replace(/\/+$/, '')}/api/tags`, { signal: timeout }).catch(() => fetch(`${base.replace(/\/+$/, '')}/v1/models`, { signal: timeout }));
        if (!r.ok) throw new Error(`${provider} returned ${r.status}`);
        return { ok: true, message: `${provider === 'ollama' ? 'Ollama' : 'LM Studio'} is running` };
      }
      case 'slack': {
        const r = await fetch('https://slack.com/api/auth.test', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Invalid Slack token');
        return { ok: true, message: `Slack: ${d.team || 'connected'}` };
      }
      case 'linear': {
        const r = await fetch('https://api.linear.app/graphql', { method: 'POST', headers: { 'Authorization': secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ viewer { name } }' }), signal: timeout });
        if (!r.ok) throw new Error(`Linear API returned ${r.status}`);
        return { ok: true, message: 'Linear API key is valid' };
      }
      case 'supabase': {
        let base = '';
        try { if (metadata) { const m = JSON.parse(metadata); if (m.url) base = m.url; } } catch {}
        if (!base) return { ok: true, message: 'Credential stored (provide url in metadata to test)' };
        const r = await fetch(`${base}/rest/v1/`, { headers: { 'apikey': secret, 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Supabase returned ${r.status}`);
        return { ok: true, message: 'Supabase connection verified' };
      }
      case 'vercel': {
        const r = await fetch('https://api.vercel.com/v2/user', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Vercel API returned ${r.status}`);
        return { ok: true, message: 'Vercel token is valid' };
      }
      case 'cloudflare': {
        const r = await fetch('https://api.cloudflare.com/client/v4/user', { headers: { 'Authorization': `Bearer ${secret}` }, signal: timeout });
        if (!r.ok) throw new Error(`Cloudflare API returned ${r.status}`);
        return { ok: true, message: 'Cloudflare token is valid' };
      }
      default:
        return { ok: true, message: `Credential saved (no live test for ${provider})` };
    }
  } catch (err) {
    return { ok: false, error: err.message || 'Connection test failed' };
  }
}

/* ══════════════ Shutdown (strict cleanup) ══════════════ */
function shutdown() {
  console.log('\n[gateway] Shutting down…');
  for (const c of connectedClients) { try { c.close(); } catch {} }
  connectedClients.clear();
  if (wsServer) try { wsServer.close(); } catch {}
  if (httpServer) try { httpServer.close(); } catch {}
  if (mcpProcess && mcpProcess.exitCode === null) {
    try { mcpProcess.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (mcpProcess && mcpProcess.exitCode === null) try { mcpProcess.kill('SIGKILL'); } catch {}
    }, 1500);
  }
  // Kill entire process group so nothing lingers
  setTimeout(() => {
    try { process.kill(-process.pid, 'SIGKILL'); } catch {}
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/* ══════════════ Start ══════════════ */
httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`[gateway] HTTP on http://127.0.0.1:${HTTP_PORT}`);
  console.log('[gateway] Endpoints: /health  /api/status  /api/chat  /api/cron');
});

startRelay();
startMCP();

console.log('──────────────────────────────');
console.log('  AMI Browser Gateway');
console.log('  Press Ctrl+C to stop');
console.log('──────────────────────────────');
