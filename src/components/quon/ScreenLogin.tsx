import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Lock, User } from "lucide-react";
import { Logo } from "./Logo";

interface Props {
  onLogin: () => void;
}

export function ScreenLogin({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (username.trim() === "QUON" && password === "BusinessCase!") {
      setError("");
      onLogin();
    } else {
      setError("Invalid username or password");
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8 text-center"
      >
        <Logo size="xl" />
        <p className="mt-3 text-sm text-quon-muted">Your AI. Your Rules. Your Data.</p>
      </motion.div>

      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-3"
      >
        <div className="flex items-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2.5 focus-within:border-quon-indigo">
          <User className="h-4 w-4 shrink-0 text-quon-muted" />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="flex-1 bg-transparent text-sm text-quon-text placeholder:text-quon-muted focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2.5 focus-within:border-quon-indigo">
          <Lock className="h-4 w-4 shrink-0 text-quon-muted" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="flex-1 bg-transparent text-sm text-quon-text placeholder:text-quon-muted focus:outline-none"
          />
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-xs text-red-400"
          >
            {error}
          </motion.div>
        )}

        <button
          type="submit"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-quon-indigo px-4 py-3 text-sm font-semibold text-white transition hover:bg-quon-indigo-hover glow-indigo"
        >
          Sign In <ArrowRight className="h-4 w-4" />
        </button>
      </motion.form>
    </div>
  );
}
