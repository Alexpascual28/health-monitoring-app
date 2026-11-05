import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Columns,
  ExternalLink,
  HeartHandshake,
  ShieldCheck,
  Smartphone,
  Watch,
} from 'lucide-react';
import type { BootstrapPayload } from './types.js';
import { subscribeCrossWindowSync } from './types.js';
import { CaregiverConsole } from './console/CaregiverConsole.js';
import { FamilyMobileApp } from './family/FamilyMobileApp.js';
import { BandSimulatorView } from './simulator/BandSimulatorView.js';

export type WorkspaceViewMode = 'CONSOLE' | 'FAMILY' | 'SIMULATOR' | 'SPLIT';

function detectInitialRoute(): {
  mode: WorkspaceViewMode;
  standalone: boolean;
} {
  if (typeof window === 'undefined') {
    return { mode: 'CONSOLE', standalone: false };
  }
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const viewParam = (params.get('view') || '').toUpperCase();
  const standalone =
    params.get('standalone') === 'true' ||
    path === '/console' ||
    path === '/family' ||
    path === '/simulator';

  if (path === '/family' || viewParam === 'FAMILY') {
    return { mode: 'FAMILY', standalone };
  }
  if (path === '/simulator' || viewParam === 'SIMULATOR') {
    return { mode: 'SIMULATOR', standalone };
  }
  if (path === '/split' || viewParam === 'SPLIT') {
    return { mode: 'SPLIT', standalone: false };
  }
  return { mode: 'CONSOLE', standalone };
}

export const App: React.FC = () => {
  const initialRoute = detectInitialRoute();
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>(
    initialRoute.mode
  );
  const [isStandalone, setIsStandalone] = useState<boolean>(
    initialRoute.standalone
  );
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [selectedPatientId, setSelectedPatientId] =
    useState<string>('PAT-1001');
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const fetchBootstrap = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/bootstrap');
      if (res.ok) {
        const data: BootstrapPayload = await res.json();
        setBootstrap(data);
      }
    } catch {
      // backend still starting
    }
  }, []);

  useEffect(() => {
    fetchBootstrap();

    // Subscribe to Cross-Window / Cross-Tab BroadcastChannel so standalone windows sync immediately
    const unsubscribeSync = subscribeCrossWindowSync(() => {
      fetchBootstrap();
    });

    // Connect to Real-Time WebSocket Hub
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
      ws.onmessage = () => {
        fetchBootstrap();
      };
    } catch {
      // ignore ws error in test
    }

    return () => {
      unsubscribeSync();
      ws?.close();
    };
  }, [fetchBootstrap]);

  const switchMode = (nextMode: WorkspaceViewMode, standaloneFlag = false) => {
    setViewMode(nextMode);
    setIsStandalone(standaloneFlag);
    const nextUrl = standaloneFlag
      ? `/?view=${nextMode.toLowerCase()}&standalone=true`
      : `/?view=${nextMode.toLowerCase()}`;
    window.history.pushState({}, '', nextUrl);
  };

  const patients = bootstrap?.patients || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Unified Workspace Switcher Bar (Hidden when in dedicated Standalone Window mode, with a discreet restore pill) */}
      {!isStandalone ? (
        <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
            {/* Brand & UK Compliance Pill */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 font-black shadow">
                <HeartHandshake className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-extrabold tracking-tight text-white sm:text-base">
                    CarePulse 24×7
                  </h1>
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-950/70 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    UK eu-west-2 • TLS 1.2+ • DPDP 2023
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  IoT Wearable Ingestion, 24×7 Caregiver Console, Overseas Family App & 5,000-Band Simulator
                </p>
              </div>
            </div>

            {/* Unified Workspace Mode Switcher */}
            <nav
              aria-label="Unified Workspace Switcher"
              className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 p-1"
            >
              <button
                type="button"
                onClick={() => switchMode('CONSOLE', false)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  viewMode === 'CONSOLE'
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                24×7 Caregiver Console
              </button>

              <button
                type="button"
                onClick={() => switchMode('FAMILY', false)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  viewMode === 'FAMILY'
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                Family Mobile App
              </button>

              <button
                type="button"
                onClick={() => switchMode('SIMULATOR', false)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  viewMode === 'SIMULATOR'
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Watch className="h-3.5 w-3.5" />
                Band & 5,000 Simulator
              </button>

              <button
                type="button"
                onClick={() => switchMode('SPLIT', false)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  viewMode === 'SPLIT'
                    ? 'bg-indigo-500 text-white shadow'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Columns className="h-3.5 w-3.5" />
                Split Triad View
              </button>
            </nav>

            {/* Standalone Window Launchers & Live WebSocket Indicator */}
            <div className="flex items-center gap-2 text-xs">
              <div className="hidden items-center gap-1.5 xl:flex">
                <a
                  href="/console?standalone=true"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-emerald-500/50 hover:text-white"
                  title="Open 24x7 Caregiver Console in an independent browser tab/window"
                >
                  Console <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href="/family?standalone=true"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-emerald-500/50 hover:text-white"
                  title="Open Family Mobile App in an independent browser tab/window"
                >
                  Family <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href="/simulator?standalone=true"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-emerald-500/50 hover:text-white"
                  title="Open Wearable Simulator in an independent browser tab/window"
                >
                  Simulator <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <span className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] font-medium">
                <span
                  className={`h-2 w-2 rounded-full ${
                    wsConnected ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {wsConnected ? 'Live Stream' : 'Sync Ready'}
              </span>
            </div>
          </div>
        </header>
      ) : (
        /* Standalone Window Header Bar */
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span className="font-bold text-white">
              CarePulse 24×7 — Standalone {viewMode} Window
            </span>
            <span className="text-slate-400">
              (Synchronized in real-time via WebSocket & BroadcastChannel)
            </span>
          </div>
          <button
            type="button"
            onClick={() => switchMode(viewMode, false)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-slate-800 cursor-pointer"
          >
            Show Unified Workspace Switcher
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="mx-auto max-w-[1600px]">
        {viewMode === 'CONSOLE' && (
          <CaregiverConsole
            bootstrap={bootstrap}
            selectedPatientId={selectedPatientId}
            onSelectPatient={setSelectedPatientId}
            onRefreshBootstrap={fetchBootstrap}
          />
        )}

        {viewMode === 'FAMILY' && (
          <FamilyMobileApp
            patients={patients}
            selectedPatientId={selectedPatientId}
            onSelectPatient={setSelectedPatientId}
            standalone={isStandalone}
          />
        )}

        {viewMode === 'SIMULATOR' && (
          <BandSimulatorView
            patients={patients}
            selectedPatientId={selectedPatientId}
            onSelectPatient={setSelectedPatientId}
            ingestionMetrics={bootstrap?.ingestionMetrics || null}
            onRefreshBootstrap={fetchBootstrap}
          />
        )}

        {viewMode === 'SPLIT' && (
          <div className="space-y-6 p-4">
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-3 text-xs text-indigo-200">
              <strong>Live Split Triad View:</strong> Trigger a Fall, SOS, or Vitals threshold breach in the <strong>Band Simulator</strong> (left), handle & close the alert in the <strong>Caregiver Console</strong> (bottom), and watch the <strong>Family Mobile App</strong> (right) update in real time.
            </div>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
              <div className="xl:col-span-7">
                <BandSimulatorView
                  patients={patients}
                  selectedPatientId={selectedPatientId}
                  onSelectPatient={setSelectedPatientId}
                  ingestionMetrics={bootstrap?.ingestionMetrics || null}
                  onRefreshBootstrap={fetchBootstrap}
                />
              </div>
              <div className="xl:col-span-5">
                <FamilyMobileApp
                  patients={patients}
                  selectedPatientId={selectedPatientId}
                  onSelectPatient={setSelectedPatientId}
                />
              </div>
            </div>
            <div className="border-t border-slate-800 pt-4">
              <CaregiverConsole
                bootstrap={bootstrap}
                selectedPatientId={selectedPatientId}
                onSelectPatient={setSelectedPatientId}
                onRefreshBootstrap={fetchBootstrap}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
