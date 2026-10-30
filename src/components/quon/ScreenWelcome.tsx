import { motion } from "motion/react";
import { ArrowRight, Globe, Shield, Zap } from "lucide-react";
import { Logo } from "./Logo";

const benefits = [
  {
    icon: Shield,
    title: "Protect your personal data",
    desc: "Personal Data is scrubbed before anything leaves your device.",
  },
  {
    icon: Zap,
    title: "Switch models in one click",
    desc: "Claude, GPT-4o, Mistral or fully local — your call.",
  },
  {
    icon: Globe,
    title: "Independent from any provider",
    desc: "No lock-in. Bring your own keys. Own your stack.",
  },
];

export function ScreenWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-2 text-center"
      >
        <Logo size="xl" />
        <p className="mt-3 text-sm text-quon-muted">Your AI. Your Rules. Your Data.</p>
      </motion.div>

      <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
        {benefits.map((b, i) => (
          <motion.div
            key={b.title}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.12, duration: 0.35 }}
            className="flex items-center gap-3 rounded-xl border border-quon-border bg-quon-surface p-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-quon-indigo/15">
              <b.icon className="h-4 w-4 text-quon-indigo" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-quon-text">{b.title}</div>
              <div className="text-xs text-quon-muted">{b.desc}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        onClick={onNext}
        className="mt-10 flex w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-quon-indigo px-4 py-3 text-sm font-semibold text-white transition hover:bg-quon-indigo-hover glow-indigo"
      >
        Get Started <ArrowRight className="h-4 w-4" />
      </motion.button>
    </div>
  );
}
