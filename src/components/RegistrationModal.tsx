import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  Calendar,
  MapPin,
  Clock,
  User,
  Mail,
  AlertCircle,
  FileCheck,
  AlertTriangle,
  Fingerprint,
  ExternalLink,
  Loader2,
  Lock,
  ArrowRight,
  Sparkles,
  ClipboardCheck,
  Hourglass
} from 'lucide-react';
import { Opportunity, VolunteerProfile, Registration, EligibilityResult, ProposedRegistrationAction, VerificationResult } from '../types';
import {
  checkEligibility,
  prepareRegistration,
  approveRegistration,
  executeRegistration
} from '../services/registrationAgentService';

interface RegistrationModalProps {
  opportunity: Opportunity | null;
  userProfile: VolunteerProfile;
  isOpen: boolean;
  onClose: () => void;
  onConfirmRegistration: (opportunity: Opportunity, userNotes: string) => Promise<{ success: boolean; error: string | null; registration?: Registration }>;
  onGoToRegisteredEvents: () => void;
}

export const RegistrationModal: React.FC<RegistrationModalProps> = ({
  opportunity,
  userProfile,
  isOpen,
  onClose,
  onConfirmRegistration,
  onGoToRegisteredEvents
}) => {
  // Deterministic Eligibility State
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [isCheckingEligibility, setIsCheckingEligibility] = useState<boolean>(true);

  // Phase A: Proposal State
  const [proposal, setProposal] = useState<ProposedRegistrationAction | null>(null);
  const [isPreparingProposal, setIsPreparingProposal] = useState<boolean>(false);
  const [userNotes, setUserNotes] = useState<string>('');
  const [bgConsentChecked, setBgConsentChecked] = useState<boolean>(userProfile.backgroundCheckConsent || false);
  const [termsConsentChecked, setTermsConsentChecked] = useState<boolean>(false);
  const [hasExplicitlyApproved, setHasExplicitlyApproved] = useState<boolean>(false);

  // Phase B: Execution State
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [verificationOutcome, setVerificationOutcome] = useState<VerificationResult | null>(null);
  const [finalState, setFinalState] = useState<'confirmed' | 'waitlisted' | 'failed' | null>(null);
  const [submittedRegistration, setSubmittedRegistration] = useState<Registration | null>(null);

  // Missing info prompt state
  const [volunteerAge, setVolunteerAge] = useState<number>(userProfile.age || 21);
  const [volunteerDob, setVolunteerDob] = useState<string>(userProfile.dateOfBirth || '');

  // Pre-flight eligibility evaluation on modal open
  useEffect(() => {
    if (isOpen && opportunity) {
      runPreFlightEligibility();
    }
  }, [isOpen, opportunity, volunteerAge, volunteerDob, bgConsentChecked]);

  const runPreFlightEligibility = async () => {
    if (!opportunity) return;
    setIsCheckingEligibility(true);
    setExecutionError(null);

    const res = await checkEligibility(
      {
        ...userProfile,
        age: volunteerAge,
        dateOfBirth: volunteerDob || undefined,
        backgroundCheckConsent: bgConsentChecked
      },
      opportunity
    );

    setIsCheckingEligibility(false);
    if (res.success && res.eligibility) {
      setEligibility(res.eligibility);

      // If eligible or awaiting consent, prepare proposal
      if (res.eligibility.status !== 'Ineligible') {
        runPrepareProposal(res.eligibility);
      } else {
        setProposal(null);
      }
    }
  };

  const runPrepareProposal = async (currentEligibility?: EligibilityResult) => {
    if (!opportunity) return;
    setIsPreparingProposal(true);

    const res = await prepareRegistration(
      {
        ...userProfile,
        age: volunteerAge,
        dateOfBirth: volunteerDob || undefined,
        backgroundCheckConsent: bgConsentChecked
      },
      opportunity,
      {
        userNotes,
        backgroundCheckConsented: bgConsentChecked
      }
    );

    setIsPreparingProposal(false);
    if (res.success && res.proposal) {
      setProposal(res.proposal);
    }
  };

  if (!isOpen || !opportunity) return null;

  // Phase B: Explicit Approval & Execution
  const handleApproveAndExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposal) return;

    if (!hasExplicitlyApproved) {
      setExecutionError('You must explicitly approve this exact proposal before it can be submitted.');
      return;
    }

    if (eligibility?.requiresBackgroundCheckConsent && !bgConsentChecked) {
      setExecutionError('This event requires explicit background check consent before registration can proceed.');
      return;
    }

    setIsExecuting(true);
    setExecutionError(null);

    try {
      // 1. Record explicit user approval on backend (locks version & action hash)
      const approvalRes = await approveRegistration(proposal.proposalId, {
        expectedVersion: proposal.version,
        expectedActionHash: proposal.actionHash,
        explicitConsentGiven: true,
        backgroundCheckConsented: bgConsentChecked
      });

      if (!approvalRes.success) {
        throw new Error(approvalRes.error || 'Failed to record explicit proposal approval.');
      }

      // 2. Execute registration workflow with independent verification
      const execRes = await executeRegistration(proposal.proposalId);
      if (!execRes.success && execRes.state === 'failed') {
        throw new Error(execRes.error || 'Failed to execute registration workflow.');
      }

      // 3. Independent Verification Outcome
      setVerificationOutcome(execRes.verificationResult);
      if (execRes.verificationResult.status === 'waitlisted') {
        setFinalState('waitlisted');
      } else {
        setFinalState('confirmed');
      }

      // 4. Synchronize with Supabase database for persistence across sessions
      const syncRes = await onConfirmRegistration(opportunity, userNotes);
      if (syncRes.success && syncRes.registration) {
        setSubmittedRegistration(syncRes.registration);
      }
    } catch (err: any) {
      setExecutionError(err?.message || 'Registration execution encountered an error.');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleClose = () => {
    setEligibility(null);
    setProposal(null);
    setHasExplicitlyApproved(false);
    setTermsConsentChecked(false);
    setUserNotes('');
    setExecutionError(null);
    setVerificationOutcome(null);
    setFinalState(null);
    setSubmittedRegistration(null);
    onClose();
  };

  const isExcluded = eligibility?.status === 'Ineligible';
  const isAwaitingConsent = eligibility?.status === 'Awaiting consent';
  const isNeedsInfo = eligibility?.status === 'Needs more information';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] border border-[#D5E0D7] rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden my-6 relative flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-[#D5E0D7] flex items-center justify-between bg-[#E8F0E9] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#244C3A] flex items-center justify-center text-[#E8F0E9] shadow-xs">
              <Fingerprint className="w-5 h-5 text-[#D6C49A]" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#315D48]">
                <span>AI Registration & Eligibility Agent</span>
                <span>·</span>
                <span>Two-Phase Commitment</span>
              </div>
              <h3 className="font-serif text-lg sm:text-xl font-bold text-[#244C3A]">
                {finalState ? 'Registration Outcome Verified' : 'Event Eligibility & Registration Approval'}
              </h3>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-white hover:bg-[#E8F0E9] text-[#244C3A] border border-[#D5E0D7] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-8 overflow-y-auto space-y-6">
          {/* Final Outcome Screen (Confirmed or Waitlisted) */}
          {finalState ? (
            <div className="text-center space-y-6 py-2">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-sm ${
                finalState === 'waitlisted'
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-[#E8F0E9] text-[#244C3A] border border-[#315D48]/30'
              }`}>
                {finalState === 'waitlisted' ? (
                  <Hourglass className="w-8 h-8" />
                ) : (
                  <CheckCircle2 className="w-8 h-8" />
                )}
              </div>

              <div className="space-y-2 max-w-md mx-auto">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider inline-block ${
                  finalState === 'waitlisted'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-[#E8F0E9] text-[#244C3A] border border-[#D5E0D7]'
                }`}>
                  {finalState === 'waitlisted' ? 'Outcome: Placed on Waitlist' : 'Outcome: Registration Confirmed'}
                </span>
                <h4 className="font-serif text-2xl font-bold text-[#244C3A]">
                  {finalState === 'waitlisted' ? 'You are on the Event Waitlist' : 'Registration Approved & Verified!'}
                </h4>
                <p className="text-xs sm:text-sm text-[#59665C] leading-relaxed">
                  {finalState === 'waitlisted'
                    ? 'The event has reached maximum active capacity. Your approved registration has been secured on the priority waitlist and recorded with evidence.'
                    : `Your registration for ${opportunity.title} has been submitted, and independent verification confirmed your spot.`}
                </p>
              </div>

              {/* Verified Evidence Box */}
              {verificationOutcome && (
                <div className="bg-[#F7FAF7] rounded-2xl border border-[#D5E0D7] p-4 text-left text-xs space-y-2.5">
                  <div className="flex items-center justify-between pb-2 border-b border-[#D5E0D7]">
                    <span className="font-bold text-[#244C3A] uppercase tracking-wider text-[11px]">
                      Independent Verification Evidence
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-[#E8F0E9] text-[10px] font-mono text-[#315D48]">
                      Verified at {new Date(verificationOutcome.verifiedAt).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-[#244C3A]">
                    {verificationOutcome.confirmationReference && (
                      <div className="flex justify-between">
                        <span className="text-[#59665C]">Reference Code:</span>
                        <span className="font-mono font-bold text-[#1A382A]">#{verificationOutcome.confirmationReference}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-[#59665C]">Destination Domain:</span>
                      <span className="font-medium text-[#1A382A]">{proposal?.destinationDomain || opportunity.sourceDomain}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#59665C]">Idempotency Key:</span>
                      <span className="font-mono text-[10px] text-[#59665C]">{proposal?.idempotencyKey.slice(0, 16)}...</span>
                    </div>
                    <div className="pt-2 border-t border-[#D5E0D7]/60">
                      <span className="text-[#59665C] block mb-1">Observed Confirmation Evidence:</span>
                      <div className="p-2.5 bg-white rounded-xl border border-[#D5E0D7] text-[#244C3A] font-mono text-[11px] leading-relaxed">
                        {verificationOutcome.sanitizedEvidence}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={() => {
                    handleClose();
                    onGoToRegisteredEvents();
                  }}
                  className="w-full sm:w-1/2 py-3 px-4 rounded-xl bg-[#244C3A] text-white text-xs font-semibold hover:bg-[#315D48] transition-colors cursor-pointer shadow-xs"
                >
                  View My Registered Events
                </button>
                <button
                  onClick={handleClose}
                  className="w-full sm:w-1/2 py-3 px-4 rounded-xl border border-[#D5DACA] bg-white text-xs font-semibold text-[#244C3A] hover:bg-[#E8F0E9] transition-colors cursor-pointer"
                >
                  Continue Browsing
                </button>
              </div>
            </div>
          ) : (
            /* Registration Workflow (Eligibility -> Phase A Review -> Phase B Approval) */
            <form onSubmit={handleApproveAndExecute} className="space-y-6">
              {executionError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-semibold block">Registration Action Blocked</span>
                    <span>{executionError}</span>
                  </div>
                </div>
              )}

              {/* Opportunity Summary Card */}
              <div className="p-4 bg-[#E8F0E9] rounded-2xl border border-[#D5E0D7] space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-[#5A7868]">
                  <span>Target Opportunity</span>
                  <span className="px-2 py-0.5 rounded-full bg-white text-[#244C3A] border border-[#D5E0D7]">
                    {opportunity.category}
                  </span>
                </div>
                <div className="font-serif text-lg font-bold text-[#244C3A]">
                  {opportunity.title}
                </div>
                <div className="text-xs font-medium text-[#315D48]">
                  {opportunity.organization} · {opportunity.location}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-[#244C3A]/80 pt-1 border-t border-[#D5E0D7]/60">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#315D48]" />
                    <span>{opportunity.date}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#315D48]" />
                    <span>{opportunity.time}</span>
                  </div>
                </div>
              </div>

              {/* Step 1: Event Eligibility Engine Result */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#59665C]">
                    1. Deterministic Eligibility Check
                  </span>
                  {isCheckingEligibility ? (
                    <span className="text-xs text-[#5A7868] flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin text-[#244C3A]" />
                      Evaluating criteria...
                    </span>
                  ) : (
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      eligibility?.status === 'Eligible'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : eligibility?.status === 'Awaiting consent'
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : eligibility?.status === 'Ineligible'
                        ? 'bg-red-100 text-red-800 border border-red-300'
                        : 'bg-blue-100 text-blue-800 border border-blue-300'
                    }`}>
                      {eligibility?.status}
                    </span>
                  )}
                </div>

                {/* Hard Disqualification Notice if Age Limit Violates Criteria */}
                {isExcluded && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-900 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-red-950">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <span>Applicant Below Minimum Age Requirement — Excluded</span>
                    </div>
                    <p className="text-red-800 leading-relaxed">
                      {eligibility?.reasons.join('. ') || `Applicant verified age (${volunteerAge}) is below the published minimum age (${opportunity.minAge}).`}
                    </p>
                    <p className="text-[11px] text-red-700 italic">
                      Strict deterministic rule enforcement: The agent is forbidden from overriding published age constraints. This event cannot be registered.
                    </p>
                  </div>
                )}

                {/* Deterministic Rules Evaluated Breakdown */}
                {eligibility && (
                  <div className="p-3 bg-white border border-[#D5E0D7] rounded-xl text-xs space-y-2">
                    {eligibility.rulesEvaluated.map((r, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-2 py-1 border-b border-[#D5E0D7]/40 last:border-0">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-[#244C3A] block">{r.rule}</span>
                          <span className="text-[11px] text-[#59665C] block">{r.details}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                          r.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {r.passed ? 'PASSED' : 'FAILED'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step 2: Phase A — Prepare Registration Proposal */}
              {!isExcluded && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#59665C]">
                      2. Phase A: Prepared Proposal & Destination Audit
                    </span>
                    {proposal && (
                      <span className="text-[11px] font-mono text-[#315D48] bg-[#E8F0E9] px-2 py-0.5 rounded">
                        Proposal v{proposal.version}
                      </span>
                    )}
                  </div>

                  {proposal ? (
                    <div className="p-4 bg-white border border-[#D5E0D7] rounded-2xl space-y-3 text-xs">
                      {/* Destination and URL */}
                      <div className="p-3 bg-[#F7FAF7] rounded-xl border border-[#D5E0D7] space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-[#59665C] uppercase">Destination Page</span>
                          <span className="text-[11px] text-[#244C3A] font-medium flex items-center gap-1">
                            <Lock className="w-3 h-3 text-emerald-600" />
                            Direct Public Portal
                          </span>
                        </div>
                        <div className="font-mono text-xs text-[#244C3A] truncate">
                          {proposal.destinationUrl}
                        </div>
                      </div>

                      {/* Information to be submitted */}
                      <div className="space-y-1.5">
                        <span className="font-semibold text-[#244C3A] block">Information to be Transmitted:</span>
                        <div className="grid grid-cols-2 gap-2 p-3 bg-[#E8F0E9]/40 rounded-xl border border-[#D5E0D7]/60 text-xs">
                          <div>
                            <span className="text-[#59665C] block text-[10px]">Volunteer Name:</span>
                            <span className="font-semibold text-[#244C3A]">{proposal.dataToSubmit.fullName}</span>
                          </div>
                          <div>
                            <span className="text-[#59665C] block text-[10px]">Email:</span>
                            <span className="font-semibold text-[#244C3A]">{proposal.dataToSubmit.email}</span>
                          </div>
                          <div>
                            <span className="text-[#59665C] block text-[10px]">Verified Age:</span>
                            <span className="font-semibold text-[#244C3A]">{proposal.dataToSubmit.verifiedAge} yrs</span>
                          </div>
                          <div>
                            <span className="text-[#59665C] block text-[10px]">Background Check:</span>
                            <span className={`font-semibold ${bgConsentChecked ? 'text-emerald-700' : 'text-amber-700'}`}>
                              {bgConsentChecked ? 'Consented' : 'Awaiting Consent'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Action Hash & Idempotency Key */}
                      <div className="pt-2 border-t border-[#D5E0D7] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[#59665C]">
                        <div className="flex items-center gap-1.5 font-mono">
                          <Fingerprint className="w-3.5 h-3.5 text-[#315D48]" />
                          <span>Action Hash: {proposal.actionHash.slice(0, 12)}...</span>
                        </div>
                        <div className="font-mono text-[10px]">
                          Key: {proposal.idempotencyKey.slice(0, 14)}...
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl text-xs text-gray-500 text-center">
                      Preparing registration proposal...
                    </div>
                  )}

                  {/* Optional message to coordinator */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#244C3A]">
                      Volunteer Notes or Availability Constraints (Optional):
                    </label>
                    <textarea
                      value={userNotes}
                      onChange={(e) => setUserNotes(e.target.value)}
                      rows={2}
                      placeholder="Mention any relevant experience or timing preferences..."
                      className="w-full p-2.5 text-xs bg-[#E8F0E9]/60 border border-[#D5E0D7] rounded-xl text-[#244C3A] placeholder-[#59665C]/50 focus:outline-none focus:ring-2 focus:ring-[#244C3A]/30"
                    />
                  </div>

                  {/* Explicit Background Check Consent Gate Checkbox */}
                  {(opportunity.backgroundCheck === 'required' || (opportunity as any).backgroundCheckRequired) && (
                    <div className="p-4 bg-amber-50/80 rounded-2xl border border-amber-300 space-y-2">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bgConsentChecked}
                          onChange={(e) => setBgConsentChecked(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded text-[#244C3A] accent-[#244C3A] focus:ring-[#244C3A] cursor-pointer"
                        />
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-amber-950 block">
                            Mandatory Background Check Consent
                          </span>
                          <span className="text-xs text-amber-900 leading-snug block">
                            I explicitly authorize <strong>{opportunity.organization}</strong> to verify my background check status as required for this volunteer role.
                          </span>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Explicit User Approval Checkbox (Two-Phase Gate) */}
                  <div className="p-4 bg-[#DFEAE1]/50 rounded-2xl border border-[#D5DACA] space-y-2">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasExplicitlyApproved}
                        onChange={(e) => setHasExplicitlyApproved(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded text-[#244C3A] accent-[#244C3A] focus:ring-[#244C3A] cursor-pointer"
                      />
                      <span className="text-xs text-[#244C3A] leading-snug">
                        <strong>Phase A Approval:</strong> I have reviewed the exact destination URL, action hash, and personal information above. I explicitly authorize the CauseConnect Agent to execute this registration on my behalf.
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#D5E0D7]">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2.5 rounded-xl border border-[#D5DACA] bg-white text-xs font-semibold text-[#244C3A] hover:bg-[#E8F0E9] transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                {!isExcluded ? (
                  <button
                    type="submit"
                    disabled={!hasExplicitlyApproved || isExecuting || (eligibility?.requiresBackgroundCheckConsent && !bgConsentChecked)}
                    className="px-6 py-2.5 rounded-xl bg-[#244C3A] hover:bg-[#315D48] text-white text-xs font-semibold transition-all shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isExecuting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#D6C49A]" />
                        <span>Phase B: Submitting & Verifying...</span>
                      </>
                    ) : (
                      <>
                        <span>Approve & Execute Registration</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="px-6 py-2.5 rounded-xl bg-gray-200 text-gray-500 text-xs font-semibold cursor-not-allowed"
                  >
                    Registration Excluded (Ineligible)
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
