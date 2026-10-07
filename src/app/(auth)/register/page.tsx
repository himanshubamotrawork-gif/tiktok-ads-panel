import { AuthForm } from "@/components/auth-form";
import { registerAction } from "@/server/actions/auth";

export default function RegisterPage() {
  return <AuthForm mode="register" action={registerAction} />;
}
