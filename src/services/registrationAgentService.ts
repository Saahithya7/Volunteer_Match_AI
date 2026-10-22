import type {
  VolunteerProfile,
  Opportunity,
  EligibilityResult,
  ProposedRegistrationAction,
  RegistrationApprovalRecord,
  VerificationResult,
  OfficialTestRun,
  ActionTraceStep
} from '../types';

/**
 * Check deterministic volunteer eligibility against published criteria
 */
export async function checkEligibility(
  volunteer: Partial<VolunteerProfile>,
  opportunity: Partial<Opportunity>
): Promise<{ success: boolean; eligibility?: EligibilityResult; error?: string }> {
  try {
    const res = await fetch('/api/agent/eligibility/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volunteer, opportunity })
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error checking eligibility' };
  }
}

/**
 * Phase A — Prepare proposed registration action, calculate action hash & idempotency key
 */
export async function prepareRegistration(
  volunteer: VolunteerProfile,
  opportunity: Opportunity,
  options?: { userNotes?: string; backgroundCheckConsented?: boolean }
): Promise<{ success: boolean; proposal?: ProposedRegistrationAction; error?: string }> {
  try {
    const res = await fetch('/api/agent/registration/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volunteer, opportunity, options })
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error preparing proposal' };
  }
}

/**
 * Phase A Confirmation — Record explicit volunteer approval for proposal version & action hash
 */
export async function approveRegistration(
  proposalId: string,
  approvalInput: {
    expectedVersion: number;
    expectedActionHash: string;
    explicitConsentGiven: boolean;
    backgroundCheckConsented: boolean;
  }
): Promise<{
  success: boolean;
  approvalRecord?: RegistrationApprovalRecord;
  proposal?: ProposedRegistrationAction;
  error?: string;
}> {
  try {
    const res = await fetch('/api/agent/registration/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposalId,
        ...approvalInput
      })
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error recording approval' };
  }
}

/**
 * Phase B — Execute approved registration and trigger independent verification
 */
export async function executeRegistration(
  proposalId: string,
  executionOptions?: { testMode?: boolean; simulatedWaitlist?: boolean }
): Promise<{
  success: boolean;
  state: string;
  proposal: ProposedRegistrationAction;
  verificationResult: VerificationResult;
  actionTrace: ActionTraceStep[];
  error?: string;
}> {
  try {
    const res = await fetch('/api/agent/registration/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId, executionOptions })
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return {
      success: false,
      state: 'failed',
      proposal: {} as any,
      verificationResult: {} as any,
      actionTrace: [],
      error: err?.message || 'Network error executing registration'
    };
  }
}

/**
 * Run the Four Official Test Runs (TC1 - TC4)
 */
export async function runOfficialTestSuite(): Promise<{
  success: boolean;
  totalRuns: number;
  passedCount: number;
  failedCount: number;
  testRuns: OfficialTestRun[];
  error?: string;
}> {
  try {
    const res = await fetch('/api/agent/test-suite/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return {
      success: false,
      totalRuns: 0,
      passedCount: 0,
      failedCount: 0,
      testRuns: [],
      error: err?.message || 'Network error running test suite'
    };
  }
}

/**
 * Fetch latest official test run records
 */
export async function getOfficialTestResults(): Promise<{
  success: boolean;
  testRuns: OfficialTestRun[];
  error?: string;
}> {
  try {
    const res = await fetch('/api/agent/test-suite/results');
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, testRuns: [], error: err?.message || 'Network error fetching test results' };
  }
}
