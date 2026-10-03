import { create } from 'zustand';
import { emptyProgress, registerReport, type BadgeId, type Progress } from '../lib/badges';
import { findRegion } from '../lib/geo';
import type { RiskLevel, Severity, SymptomId, SymptomMap } from '../lib/redflags';

export type TabKey = 'check' | 'report' | 'dashboard';

export type AgeGroup = 'adult' | 'child';

export interface AnswerState {
  symptoms: SymptomMap;
  ageGroup: AgeGroup;
  durationDays: number | null;
  soughtCare: 'yes' | 'no' | 'pending' | null;
  regionCode: string | null;
}

export interface ResultState {
  level: RiskLevel;
  forcedEmergency: boolean;
  /** Environmental level, when a region and climate were available. */
  environmental: RiskLevel | null;
  climateLive: boolean;
  at: number;
}

interface AppState {
  tab: TabKey;
  answer: AnswerState;
  result: ResultState | null;
  progress: Progress;
  /** Set when a report is waiting on the network. */
  queued: number;
  online: boolean;

  setTab: (tab: TabKey) => void;
  setSeverity: (id: SymptomId, sev: Severity) => void;
  setAgeGroup: (g: AgeGroup) => void;
  setDuration: (days: number | null) => void;
  setSoughtCare: (v: 'yes' | 'no' | 'pending') => void;
  setRegion: (code: string | null) => void;
  resetAnswer: () => void;
  setResult: (r: ResultState) => void;
  clearResult: () => void;
  recordReport: (today?: Date) => BadgeId[];
  setProgress: (p: Progress) => void;
  setQueued: (n: number) => void;
  setOnline: (v: boolean) => void;
}

const blankAnswer = (): AnswerState => ({
  symptoms: {},
  ageGroup: 'adult',
  durationDays: null,
  soughtCare: null,
  regionCode: null,
});

const STORAGE_KEY = 'malariax.progress';

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return { ...emptyProgress(), ...parsed, badges: parsed.badges ?? [] };
  } catch {
    return emptyProgress();
  }
}

function persist(p: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked; progress stays in memory for this session */
  }
}

export const useApp = create<AppState>((set, get) => ({
  tab: 'check',
  answer: blankAnswer(),
  result: null,
  progress: loadProgress(),
  queued: 0,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,

  setTab: (tab) => set({ tab }),

  setSeverity: (id, sev) =>
    set((s) => {
      const symptoms = { ...s.answer.symptoms };
      if (sev === 'none') delete symptoms[id];
      else symptoms[id] = sev;
      return { answer: { ...s.answer, symptoms } };
    }),

  setAgeGroup: (ageGroup) => set((s) => ({ answer: { ...s.answer, ageGroup } })),
  setDuration: (durationDays) => set((s) => ({ answer: { ...s.answer, durationDays } })),
  setSoughtCare: (soughtCare) => set((s) => ({ answer: { ...s.answer, soughtCare } })),
  setRegion: (regionCode) => set((s) => ({ answer: { ...s.answer, regionCode } })),

  resetAnswer: () => set({ answer: blankAnswer(), result: null }),
  setResult: (result) => set({ result }),
  clearResult: () => set({ result: null }),

  recordReport: (today) => {
    const { earned, progress } = registerReport(get().progress, today);
    persist(progress);
    set({ progress });
    return earned;
  },

  setProgress: (progress) => {
    persist(progress);
    set({ progress });
  },

  setQueued: (queued) => set({ queued }),
  setOnline: (online) => set({ online }),
}));

/** Convenience for components that need the resolved region object. */
export const selectedRegion = (code: string | null | undefined) => findRegion(code);