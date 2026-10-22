import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getBrowserbaseStatus,
  sanitizeSearchParams,
  executeVolunteerDiscoveryAgent,
  releaseAllRunningSessions,
  cleanAndDeduplicateOpportunities,
  BROWSERBASE_AGENT_NAME
} from './src/server/browserbaseAgent.js';
import {
  evaluateEligibility,
  prepareRegistrationProposal,
  recordProposalApproval,
  executeRegistrationWorkflow,
  runOfficialTestSuite,
  getLatestOfficialTestRuns,
  getProposalById
} from './src/server/registrationAgent.js';
import { Browserbase } from '@browserbasehq/sdk';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // JSON Body Parser with reasonable limits
  app.use(express.json({ limit: '5mb' }));

  // Basic security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // -------------------------------------------------------------
  // Browserbase Agent API Endpoints
  // -------------------------------------------------------------

  /**
   * GET /api/browserbase/status
   * Safe status check: confirms configuration without leaking API keys
   */
  app.get('/api/browserbase/status', (req, res) => {
    try {
      const status = getBrowserbaseStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({
        configured: false,
        error: 'Failed to inspect Browserbase status'
      });
    }
  });

  /**
   * Core volunteer opportunity search handler powered by Browserbase
   */
  const handleVolunteerSearch = async (req: express.Request, res: express.Response) => {
    try {
      const { valid, params, errorMessage } = sanitizeSearchParams(req.body);
      if (!valid) {
        return res.status(400).json({
          success: false,
          configured: false,
          agent_name: BROWSERBASE_AGENT_NAME,
          opportunities: [],
          error: errorMessage || 'Invalid search parameters'
        });
      }

      const result = await executeVolunteerDiscoveryAgent(params);
      res.json(result);
    } catch (err: any) {
      console.error('Volunteer search error:', err?.message || err);
      res.status(500).json({
        success: false,
        configured: false,
        agent_name: BROWSERBASE_AGENT_NAME,
        opportunities: [],
        error: 'An internal error occurred while executing the volunteer event finder.'
      });
    }
  };

  /**
   * POST /api/volunteer-search
   * Primary server-side volunteer opportunity search agent powered by Browserbase
   */
  app.post('/api/volunteer-search', handleVolunteerSearch);

  /**
   * POST /api/browserbase/search
   * Backward-compatible alias for volunteer search
   */
  app.post('/api/browserbase/search', handleVolunteerSearch);

  /**
   * GET /api/browserbase/runs/:runId
   * Retrieve status for an existing agent run
   */
  app.get('/api/browserbase/runs/:runId', async (req, res) => {
    try {
      const runId = req.params.runId;
      if (!runId || !process.env.BROWSERBASE_API_KEY) {
        return res.status(400).json({
          success: false,
          error: 'Invalid run ID or unconfigured Browserbase API key'
        });
      }

      const bb = new Browserbase({
        apiKey: process.env.BROWSERBASE_API_KEY
      });

      const run = await bb.agents.runs.retrieve(runId);
      let opportunities: any[] = [];
      if (run.status === 'COMPLETED') {
        const raw =
          (run.result as any)?.output?.opportunities ||
          (run.result as any)?.opportunities ||
          [];
        opportunities = cleanAndDeduplicateOpportunities(raw, { location: 'Target City' });
      }

      res.json({
        success: true,
        runId: run.runId,
        status: run.status,
        opportunities,
        result: run.result,
        endedAt: run.endedAt
      });
    } catch (err: any) {
      const msg = (err?.message || 'Failed to retrieve agent run').replace(
        /bb_[a-zA-Z0-9_-]+/g,
        '[REDACTED]'
      );
      res.status(500).json({ success: false, error: msg });
    }
  });

  /**
   * POST /api/browserbase/release-sessions
   * Forcefully releases active browser sessions to free up runner concurrency
   */
  app.post('/api/browserbase/release-sessions', async (req, res) => {
    try {
      const result = await releaseAllRunningSessions();
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('Failed to release sessions:', err?.message || err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to release sessions' });
    }
  });

  // -------------------------------------------------------------
  // AI Volunteer Registration & Eligibility Agent Endpoints
  // -------------------------------------------------------------

  /**
   * POST /api/agent/eligibility/check
   * Deterministic evaluation of age, schedule, skills, and background check
   */
  app.post('/api/agent/eligibility/check', (req, res) => {
    try {
      const { volunteer, opportunity } = req.body || {};
      if (!volunteer || !opportunity) {
        return res.status(400).json({
          success: false,
          error: 'volunteer and opportunity payloads are required'
        });
      }
      const eligibility = evaluateEligibility(volunteer, opportunity);
      res.json({ success: true, eligibility });
    } catch (err: any) {
      console.error('Eligibility check error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Eligibility check failed' });
    }
  });

  /**
   * POST /api/agent/registration/prepare
   * Phase A — Generate proposed registration action, action hash, and idempotency key
   */
  app.post('/api/agent/registration/prepare', (req, res) => {
    try {
      const { volunteer, opportunity, options } = req.body || {};
      if (!volunteer || !opportunity) {
        return res.status(400).json({
          success: false,
          error: 'volunteer and opportunity objects are required to prepare proposal'
        });
      }
      const proposal = prepareRegistrationProposal(volunteer, opportunity, options);
      res.json({ success: true, proposal });
    } catch (err: any) {
      console.error('Prepare registration error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to prepare proposal' });
    }
  });

  /**
   * POST /api/agent/registration/approve
   * Phase A Confirmation — Record explicit user approval of the specific proposal version & action hash
   */
  app.post('/api/agent/registration/approve', (req, res) => {
    try {
      const { proposalId, expectedVersion, expectedActionHash, explicitConsentGiven, backgroundCheckConsented } = req.body || {};
      if (!proposalId) {
        return res.status(400).json({ success: false, error: 'proposalId is required' });
      }
      const result = recordProposalApproval(proposalId, {
        expectedVersion: Number(expectedVersion) || 1,
        expectedActionHash: String(expectedActionHash || ''),
        explicitConsentGiven: Boolean(explicitConsentGiven),
        backgroundCheckConsented: Boolean(backgroundCheckConsented),
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
      });
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: any) {
      console.error('Record approval error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to record approval' });
    }
  });

  /**
   * POST /api/agent/registration/execute
   * Phase B — Execute approved action, prevent duplicate submissions, and run independent verification
   */
  app.post('/api/agent/registration/execute', async (req, res) => {
    try {
      const { proposalId, executionOptions } = req.body || {};
      if (!proposalId) {
        return res.status(400).json({ success: false, error: 'proposalId is required' });
      }
      const result = await executeRegistrationWorkflow(proposalId, executionOptions);
      res.json(result);
    } catch (err: any) {
      console.error('Execute registration error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to execute registration' });
    }
  });

  /**
   * GET /api/agent/proposal/:proposalId
   * Retrieve state of a proposed or approved registration action
   */
  app.get('/api/agent/proposal/:proposalId', (req, res) => {
    try {
      const stored = getProposalById(req.params.proposalId);
      if (!stored) {
        return res.status(404).json({ success: false, error: 'Proposal not found' });
      }
      res.json({ success: true, ...stored });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to retrieve proposal' });
    }
  });

  /**
   * POST /api/agent/test-suite/run
   * Execute the Four Official Test Runs (TC1 - TC4)
   */
  app.post('/api/agent/test-suite/run', async (req, res) => {
    try {
      const testRuns = await runOfficialTestSuite();
      res.json({
        success: true,
        totalRuns: testRuns.length,
        passedCount: testRuns.filter((r) => r.status === 'passed').length,
        failedCount: testRuns.filter((r) => r.status === 'failed').length,
        testRuns
      });
    } catch (err: any) {
      console.error('Official test suite execution error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to run test suite' });
    }
  });

  /**
   * GET /api/agent/test-suite/results
   * Retrieve latest official test run records
   */
  app.get('/api/agent/test-suite/results', (req, res) => {
    try {
      const testRuns = getLatestOfficialTestRuns();
      res.json({
        success: true,
        testRuns
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to retrieve test runs' });
    }
  });

  // -------------------------------------------------------------
  // Vite Integration (Dev middleware or Production static files)
  // -------------------------------------------------------------
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        hmr: process.env.DISABLE_HMR !== 'true'
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CauseConnect AI Server] Running on http://0.0.0.0:${PORT}`);
    console.log(`[CauseConnect AI Server] Browserbase Agent configured: ${getBrowserbaseStatus().configured}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
