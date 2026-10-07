"use client";

import { useActionState } from "react";
import { addMemberAction } from "@/server/actions/auth";
import { Button } from "./ui/primitives";

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMemberAction, {});
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <div className="w-72">
        <input name="email" type="email" required placeholder="teammate@example.com" className="input" aria-label="Member email" />
        {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
        {state.message && <p className="mt-1 text-xs text-emerald-700">{state.message}</p>}
      </div>
      <Button type="submit" loading={pending}>
        Add member
      </Button>
    </form>
  );
}
