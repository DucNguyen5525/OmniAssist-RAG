"use client";

import { Lock, User, LogIn, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setError(undefined);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, rememberMe }),
      });

      if (res.ok) {
        const nextPath = new URLSearchParams(window.location.search).get("next");
        router.push(nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard");
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error || "Tên đăng nhập hoặc mật khẩu không đúng.");
      }
    } catch {
      setError("Không thể kết nối đến máy chủ.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900 p-4">
      {/* Decorative background elements */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-mint/10 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-coral/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl border border-stone-700/50 bg-stone-800/80 p-8 shadow-2xl backdrop-blur-sm">
          {/* Logo / Branding */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint text-white shadow-lg shadow-mint/25">
              <Sparkles size={28} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Helpdesk RAG
            </h1>
            <p className="mt-1.5 text-sm text-stone-400">
              Đăng nhập để quản lý hệ thống trợ lý tri thức
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 rounded-lg border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral">
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-xs font-medium text-stone-300"
              >
                Tên đăng nhập
              </label>
              <div className="relative">
                <User
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500"
                />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Tên đăng nhập"
                  autoComplete="username"
                  disabled={isLoading}
                  className="w-full rounded-lg border border-stone-600 bg-stone-700/50 py-2.5 pl-10 pr-4 text-sm text-white placeholder-stone-500 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-medium text-stone-300"
              >
                Mật khẩu
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500"
                />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mật khẩu"
                  autoComplete="current-password"
                  disabled={isLoading}
                  className="w-full rounded-lg border border-stone-600 bg-stone-700/50 py-2.5 pl-10 pr-4 text-sm text-white placeholder-stone-500 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Remember Me Checkbox */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex cursor-pointer items-center gap-2 select-none text-xs text-stone-300">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={isLoading}
                  className="h-4 w-4 rounded border-stone-600 bg-stone-700/50 text-mint focus:ring-mint/20 accent-mint"
                />
                <span>Ghi nhớ đăng nhập (30 ngày)</span>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !username.trim() || !password.trim()}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-mint py-2.5 text-sm font-semibold text-white shadow-lg shadow-mint/25 transition-all hover:bg-mint/90 active:scale-[0.98] disabled:opacity-50 disabled:hover:bg-mint"
            >
              {isLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <LogIn size={16} />
              )}
              <span>{isLoading ? "Đang đăng nhập..." : "Đăng nhập"}</span>
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-stone-500">
          Helpdesk System
        </p>
      </div>
    </div>
  );
}
