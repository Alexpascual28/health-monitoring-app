import React, { useEffect, useState } from 'react';
import {
  Battery,
  CheckCircle2,
  Clock,
  Heart,
  Lock,
  MapPin,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
  Watch,
} from 'lucide-react';
import type { FamilyCalmViewPayload, PatientRecord } from '../types.js';

interface FamilyMobileAppProps {
  patients: PatientRecord[];
  selectedPatientId: string;
  onSelectPatient: (id: string) => void;
  standalone?: boolean;
}

export const FamilyMobileApp: React.FC<FamilyMobileAppProps> = ({
  patients,
  selectedPatientId,
  onSelectPatient,
  standalone = false,
}) => {
  const [isOtpAuthenticated, setIsOtpAuthenticated] = useState<boolean>(true);
  const [phoneInput, setPhoneInput] = useState<string>('+14165550192');
  const [otpInput, setOtpInput] = useState<string>('482910');
  const [otpRequestedMsg, setOtpRequestedMsg] = useState<string>('');
  const [calmView, setCalmView] = useState<FamilyCalmViewPayload | null>(null);
  const [callBanner, setCallBanner] = useState<string | null>(null);

  const loadCalmView = async (patId: string) => {
    try {
      const res = await fetch(`/api/v1/family/patients/${patId}/calm-view`);
      if (res.ok) {
        const data: FamilyCalmViewPayload = await res.json();
        setCalmView(data);
      }
    } catch {
      // ignore transient error
    }
  };

  useEffect(() => {
    if (selectedPatientId) {
      loadCalmView(selectedPatientId);
    }
  }, [selectedPatientId, patients]);

  const handleRequestOtp = async () => {
    try {
      const res = await fetch('/api/v1/family/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneE164: phoneInput,
          patientId: selectedPatientId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setOtpRequestedMsg(
          `OTP sent to ${data.phoneE164} (${data.countryCode}) • Demo Code: ${data.devOtpPreview}`
        );
        setOtpInput(data.devOtpPreview);
      } else {
        setOtpRequestedMsg(data.error || 'Invalid phone format');
      }
    } catch (err) {
      setOtpRequestedMsg((err as Error).message);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/v1/family/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneE164: phoneInput, otpCode: otpInput }),
    });
    if (res.ok) {
      setIsOtpAuthenticated(true);
      loadCalmView(selectedPatientId);
    } else {
      setOtpRequestedMsg('Invalid OTP code. Use 482910 for demo.');
    }
  };

  return (
    <div className={standalone ? 'min-h-screen bg-slate-950 py-6 px-4' : 'py-4 px-2'}>
      {/* Android 10 / 3GB RAM / 3G Optimized Mobile Viewport Container */}
      <div className="mx-auto max-w-md overflow-hidden rounded-3xl border-4 border-slate-800 bg-slate-900 shadow-2xl">
        {/* Android Status Bar */}
        <div className="flex items-center justify-between bg-slate-950 px-5 py-2 text-[11px] font-medium text-slate-400">
          <span className="flex items-center gap-1.5">
            <Smartphone className="h-3.5 w-3.5 text-emerald-400" />
            CarePulse Family • Android 10 / 3G Lite
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsOtpAuthenticated(!isOtpAuthenticated)}
              className="text-[10px] text-sky-400 underline cursor-pointer"
            >
              {isOtpAuthenticated ? 'Switch OTP Account' : 'Skip to View'}
            </button>
          </div>
        </div>

        {!isOtpAuthenticated ? (
          /* International OTP Sign-In Screen */
          <form onSubmit={handleVerifyOtp} className="space-y-4 p-6">
            <div className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
                <Lock className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-bold text-white">
                Overseas Family OTP Sign-In
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Supports international numbers (+1 US/CA, +44 UK, +91 IN, +61 AU, +65 SG)
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                International Mobile Number (E.164)
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="+14165550192"
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-slate-700 cursor-pointer"
                >
                  Send OTP
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                {[
                  { label: '🇨🇦 +1 Toronto', phone: '+14165550192' },
                  { label: '🇮🇳 +91 Mumbai', phone: '+919820155432' },
                  { label: '🇦🇺 +61 Sydney', phone: '+61412555890' },
                  { label: '🇬🇧 +44 London', phone: '+447700900123' },
                ].map((preset) => (
                  <button
                    key={preset.phone}
                    type="button"
                    onClick={() => setPhoneInput(preset.phone)}
                    className="rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 text-slate-300 hover:border-emerald-500/50 cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                6-Digit One-Time Passcode
              </label>
              <input
                type="text"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center font-mono text-lg tracking-widest text-emerald-400"
              />
            </div>

            {otpRequestedMsg && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-2.5 text-xs text-emerald-300">
                {otpRequestedMsg}
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
            >
              Verify & Open Calm Family View
            </button>
          </form>
        ) : (
          /* Main Calm Family Mobile Screen */
          <div className="space-y-4 p-5">
            {/* Resident Switcher Header */}
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                  Is My Parent OK?
                </div>
                <select
                  aria-label="Select family resident"
                  value={selectedPatientId}
                  onChange={(e) => onSelectPatient(e.target.value)}
                  className="mt-0.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-sm font-bold text-white"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.roomOrFlat.split('-')[0].trim()})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => loadCalmView(selectedPatientId)}
                className="rounded-full border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white cursor-pointer"
                title="Refresh status"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            {calmView && (
              <>
                {/* "Is My Parent OK?" Calm Reassurance Hero Card */}
                <div
                  className={`rounded-2xl border p-4 shadow-lg ${
                    calmView.overallStatus === 'CALM_OK'
                      ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-950/80 to-slate-900'
                      : calmView.overallStatus === 'ATTENTION_BEING_HANDLED'
                      ? 'border-amber-500/50 bg-gradient-to-br from-amber-950/80 to-slate-900'
                      : 'border-sky-500/40 bg-gradient-to-br from-sky-950/70 to-slate-900'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-emerald-500/20 p-2 text-emerald-300">
                      {calmView.overallStatus === 'CALM_OK' ? (
                        <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                      ) : (
                        <Sparkles className="h-6 w-6 text-amber-300" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-bold text-white">
                        {calmView.calmHeadline}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-200">
                        {calmView.calmSubtext}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
                        <span className="flex items-center gap-1">
                          <Watch className="h-3.5 w-3.5 text-emerald-400" />
                          {calmView.wearState.replace('_', ' ')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Battery className="h-3.5 w-3.5 text-emerald-400" />
                          Band {calmView.batteryPct}%
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-sky-400" />
                          Updated{' '}
                          {new Date(calmView.lastCheckedIso).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Consent-Limited Vitals Snapshot (DPDP Act 2023 Enforced) */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Wellness Snapshot (Non-Diagnostic)
                    </span>
                    <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      <ShieldCheck className="h-3 w-3" />
                      DPDP Consent: {calmView.consentStatus}
                    </span>
                  </div>

                  {calmView.vitalsShared && calmView.vitals ? (
                    <div className="mt-3 grid grid-cols-3 gap-2.5 text-center">
                      <div className="rounded-xl border border-slate-800 bg-slate-900 p-2.5">
                        <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                          <Heart className="h-3 w-3 text-rose-400" />
                          Resting HR
                        </div>
                        <div className="mt-1 text-lg font-extrabold text-white">
                          {calmView.vitals.heartRateBpm}{' '}
                          <span className="text-[10px] font-normal text-slate-400">
                            bpm
                          </span>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-900 p-2.5">
                        <div className="text-[11px] text-slate-400">SpO2 Level</div>
                        <div className="mt-1 text-lg font-extrabold text-sky-400">
                          {calmView.vitals.spo2Pct}%
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-900 p-2.5">
                        <div className="text-[11px] text-slate-400">Daily Steps</div>
                        <div className="mt-1 text-lg font-extrabold text-emerald-400">
                          {calmView.vitals.stepsCount.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
                      <strong>Vitals Redacted by DPDP Act 2023 Consent Preference:</strong>{' '}
                      {calmView.preferredName} has paused granular vitals sharing with the Family App. Overall safety status and 24×7 caregiver monitoring remain active.
                    </div>
                  )}

                  {/* Safe-Zone Location Summary */}
                  <div className="mt-3 border-t border-slate-800/80 pt-2.5 text-xs">
                    {calmView.gpsShared && calmView.locationSummary ? (
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                          {calmView.locationSummary.safeZoneLabel}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            calmView.locationSummary.insideGeofence
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {calmView.locationSummary.insideGeofence
                            ? 'Inside Safe Zone'
                            : `${calmView.locationSummary.distanceFromSafeZoneM}m Outside`}
                        </span>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400">
                        GPS location sharing disabled by resident DPDP consent preference.
                      </div>
                    )}
                  </div>
                </div>

                {/* Alert History with Caregiver Disposition */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Recent Caregiver Checks & Alert Dispositions
                  </h4>
                  <div className="mt-2.5 space-y-2.5">
                    {calmView.recentAlertsWithDisposition.length === 0 ? (
                      <div className="text-xs text-slate-400">
                        No recent alerts. Everything has been calm and steady.
                      </div>
                    ) : (
                      calmView.recentAlertsWithDisposition.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-800 bg-slate-900/90 p-3 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-white">
                              {item.title}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                item.state === 'CLOSED'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {item.state}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-300">
                            {item.caregiverDisposition}
                          </p>
                          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <UserCheck className="h-3 w-3 text-emerald-400" />
                              {item.handledBy}
                            </span>
                            <span>
                              {new Date(item.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* One-Tap Call Bar */}
                {callBanner && (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/60 p-3 text-center text-xs font-semibold text-emerald-200">
                    {callBanner}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <a
                    href={`tel:${calmView.contacts.careCentreDeskPhone}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setCallBanner(
                        `Dialling 24×7 Caregiver Desk (${calmView.contacts.careCentreDeskPhone})...`
                      );
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-xs font-bold text-slate-950 shadow hover:bg-emerald-400"
                  >
                    <PhoneCall className="h-4 w-4" />
                    Call 24×7 Care Desk
                  </a>

                  <a
                    href={`tel:${calmView.contacts.residentDirectPhone}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setCallBanner(
                        `Calling ${calmView.preferredName} (${calmView.contacts.residentDirectPhone})...`
                      );
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 py-3 text-xs font-bold text-white hover:bg-slate-700"
                  >
                    <PhoneCall className="h-4 w-4 text-sky-400" />
                    Call {calmView.preferredName}
                  </a>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
