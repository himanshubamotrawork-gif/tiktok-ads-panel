"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/server/actions/auth";
import { Button, ErrorBanner, Field } from "./ui/primitives";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export function AuthForm({ mode, action }: { mode: "login" | "register"; action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const register = mode === "register";

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form action={formAction} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{register ? "Create your account" : "Sign in"}</h1>
          <p className="mt-1 text-sm text-slate-500">TikTok Ads Panel</p>
        </div>
        {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
        {register && (
          <>
            <Field label="Your name">
              <input name="name" className="input" autoComplete="name" required />
            </Field>
            <Field label="Workspace name" hint="A workspace holds one TikTok connection shared by its members.">
              <input name="workspace" className="input" required />
            </Field>
          </>
        )}
        <Field label="Email">
          <input name="email" type="email" className="input" autoComplete="email" required />
        </Field>
        <Field label="Password" hint={register ? "At least 8 characters." : undefined}>
          <input
            name="password"
            type="password"
            className="input"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </Field>
        <Button type="submit" variant="primary" loading={pending} className="w-full">
          {register ? "Create account" : "Sign in"}
        </Button>
        <p className="text-center text-sm text-slate-500">
          {register ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-brand-600 hover:underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link href="/register" className="font-medium text-brand-600 hover:underline">
                Create an account
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
