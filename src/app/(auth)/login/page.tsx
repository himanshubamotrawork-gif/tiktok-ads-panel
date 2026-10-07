import { AuthForm } from "@/components/auth-form";
import { loginAction } from "@/server/actions/auth";

export default function LoginPage() {
  return <AuthForm mode="login" action={loginAction} />;
}
